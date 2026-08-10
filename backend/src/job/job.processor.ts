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
    const { filePath, isYoutube, isYoutubePreview, url } = job.data;
    
    this.logger.log(`Processing job ${job.id}`);

    if (!isYoutube && !isYoutubePreview && !existsSync(filePath)) {
      throw new Error(`File ${filePath} not found`);
    }

    // Prepare results directory
    const resultsDir = join(process.cwd(), 'results');
    if (!existsSync(resultsDir)) {
      mkdirSync(resultsDir);
    }

    await job.updateProgress({ percent: 2, message: 'Initializing job...' }); // Initial progress

    try {
      // 1. Upload to Python FastAPI service
      // We assume the python service is running on localhost:8000
      const { trimSilence = false, isYoutube, url } = job.data;
      
      let uploadResponse;
      if (isYoutubePreview) {
        this.logger.log(`Downloading youtube preview...`);
        await job.updateProgress({ percent: 50, message: 'Downloading audio from YouTube...' });
        uploadResponse = await fetch('http://localhost:8000/download-youtube-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        
        if (!uploadResponse.ok) {
           const errResult = await uploadResponse.json().catch(() => ({}));
           throw new Error(errResult.detail || `Failed to download youtube preview: ${uploadResponse.statusText}`);
        }
        
        const result = await uploadResponse.json();
        await job.updateProgress({ percent: 100, message: 'Done' });
        
        return {
          // The python service saves it to UPLOAD_DIR as {job_id}.mp3 or similar
          // Actually, yt_dlp output template might use the video's original ext, but let's assume it returns { job_id, status }
          // We can serve it from the python service directly via /raw-download/{job_id} or let python service do it.
          // Wait, python service returns {"job_id": job_id, "status": "completed"}
          previewId: result.job_id,
          previewUrl: `http://localhost:8000/raw-download/${result.job_id}`
        };
      }
      else if (isYoutube) {
        this.logger.log(`Sending youtube URL to separation service...`);
        await job.updateProgress({ percent: 5, message: 'Downloading audio from YouTube (this may take a minute)...' });
        uploadResponse = await fetch('http://localhost:8000/upload-youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, trim_silence: trimSilence }),
        });
      } else {
        await job.updateProgress({ percent: 10, message: 'Uploading file to separation service...' });
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

      await job.updateProgress({ percent: 30, message: 'Separating vocals (this may take a few minutes)...' }); // 30% - file uploaded, separation started

      // 2. Poll the python service for completion
      let isCompleted = false;
      let attempts = 0;
      const maxAttempts = 1500; // 1500 * 2s = 50 minutes max waiting for CPU
      
      while (!isCompleted && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2 seconds
        attempts++;
        
        const statusResponse = await fetch(`http://localhost:8000/status/${separationJobId}`);
        const statusResult = await statusResponse.json();
        
        if (statusResult.status === 'completed') {
          isCompleted = true;
          await job.updateProgress({ percent: 100, message: 'Processing complete!' });
        } else if (statusResult.status === 'processing') {
          const currentProgress = statusResult.progress !== undefined ? statusResult.progress : 50;
          const msg = statusResult.message || 'Processing...';
          await job.updateProgress({ percent: currentProgress, message: msg });
        } else if (statusResult.status === 'failed') {
          throw new Error('Separation process failed on python side');
        } else if (statusResult.status === 'not_found') {
          throw new Error('Separation job not found on python service');
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

      await job.updateProgress({ percent: 100, message: 'Done' });
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
