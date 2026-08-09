import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class JobService {
  constructor(
    @InjectQueue('audio-separation') private audioQueue: Queue,
  ) {}

  async createJob(filePath: string, format: string = 'mp3', trimSilence: boolean = false) {
    const job = await this.audioQueue.add('separate-vocals', {
      filePath,
      format,
      trimSilence
    });
    
    return {
      jobId: job.id,
      status: 'queued'
    };
  }

  async createYoutubeJob(url: string, trimSilence: boolean = false) {
    const job = await this.audioQueue.add('separate-youtube', {
      isYoutube: true,
      url,
      trimSilence
    });
    
    return {
      jobId: job.id,
      status: 'queued'
    };
  }

  async getJobStatus(jobId: string) {
    const job = await this.audioQueue.getJob(jobId);
    
    if (!job) {
      return { status: 'not_found' };
    }
    
    const state = await job.getState();
    const progress = job.progress;
    const returnvalue = job.returnvalue;
    const failedReason = job.failedReason;

    return {
      jobId,
      status: state, // 'completed', 'failed', 'delayed', 'active', 'waiting', etc.
      progress,
      resultUrl: returnvalue?.resultUrl,
      error: failedReason
    };
  }
}
