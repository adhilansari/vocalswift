import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import FormData = require('form-data');
import { createReadStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import fetch from 'node-fetch'; // You will need to install node-fetch or use native fetch if Node 18+

@Processor('audio-separation')
export class AudioJobProcessor extends WorkerHost {
  private readonly logger = new Logger(AudioJobProcessor.name);

  async process(job: Job<any, any, string>): Promise<any> {
    const { filePath, isYoutube, url } = job.data;
    
    this.logger.log(`Processing job ${job.id}`);

    if (!isYoutube && !existsSync(filePath)) {
      throw new Error(`File ${filePath} not found`);
    }

    // Prepare results directory
    const resultsDir = join(process.cwd(), 'results');
    if (!existsSync(resultsDir)) {
      mkdirSync(resultsDir);
    }

    await job.updateProgress(10); // 10% - starting upload to python service

    try {
      // 1. Upload to Python FastAPI service
      // We assume the python service is running on localhost:8000
      const { trimSilence = false, isYoutube, url } = job.data;
      
      let uploadResponse;
      if (isYoutube) {
        this.logger.log(`Sending youtube URL to separation service...`);
        uploadResponse = await fetch('http://localhost:8000/upload-youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, trim_silence: trimSilence }),
        });
      } else {
        const formData = new FormData();
        formData.append('file', createReadStream(filePath));
        formData.append('trim_silence', String(trimSilence));

        this.logger.log(`Sending file to separation service...`);
        uploadResponse = await fetch('http://localhost:8000/upload', {
          method: 'POST',
          body: formData,
        });
      }

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload to separation service: ${uploadResponse.statusText}`);
      }

      const uploadResult = await uploadResponse.json();
      const separationJobId = uploadResult.job_id;

      await job.updateProgress(30); // 30% - file uploaded, separation started

      // 2. Poll the python service for completion
      let isCompleted = false;
      let attempts = 0;
      const maxAttempts = 600; // 600 * 5s = 50 minutes max waiting for CPU
      
      while (!isCompleted && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5 seconds
        attempts++;
        
        const statusResponse = await fetch(`http://localhost:8000/status/${separationJobId}`);
        const statusResult = await statusResponse.json();
        
        if (statusResult.status === 'completed') {
          isCompleted = true;
          await job.updateProgress(80); // 80% - separation done, downloading result
        } else if (statusResult.status === 'processing') {
          // Fake progress between 30 and 80 based on time
          const currentProgress = Math.min(75, 30 + (attempts * 0.5));
          await job.updateProgress(Math.floor(currentProgress));
        } else if (statusResult.status === 'not_found') {
          throw new Error('Separation job not found on python service');
        } else if (statusResult.status === 'failed') {
          throw new Error('Separation process failed on python service');
        }
      }

      if (!isCompleted) {
        throw new Error('Separation timed out');
      }

      // 3. Download the result from Python service
      const downloadResponse = await fetch(`http://localhost:8000/download/${separationJobId}`);
      if (!downloadResponse.ok) {
         throw new Error(`Failed to download result: ${downloadResponse.statusText}`);
      }

      const finalFilePath = join(resultsDir, `${job.id}.mp3`);
      
      // Node 18+ fetch returns a web stream, we can pipe it
      const fs = await import('fs');
      const { pipeline } = await import('stream/promises');
      
      if (downloadResponse.body) {
        // @ts-ignore
        await pipeline(downloadResponse.body, fs.createWriteStream(finalFilePath));
      } else {
        throw new Error('Empty response body');
      }

      await job.updateProgress(100);
      this.logger.log(`Job ${job.id} completed. Result saved to ${finalFilePath}`);
      
      return {
        resultUrl: `/api/jobs/download/${job.id}`
      };

    } catch (error) {
      this.logger.error(`Job ${job.id} failed:`, error);
      throw error;
    }
  }
}
