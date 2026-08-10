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

  async createYoutubePreviewJob(url: string) {
    const job = await this.audioQueue.add('preview-youtube', {
      isYoutubePreview: true,
      url,
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
    const progressData = job.progress;
    
    let progress = 0;
    let message = '';
    
    if (typeof progressData === 'object' && progressData !== null) {
      progress = (progressData as any).percent || 0;
      message = (progressData as any).message || '';
    } else if (typeof progressData === 'number') {
      progress = progressData;
    }
    
    const returnvalue = job.returnvalue;
    const failedReason = job.failedReason;

    return {
      jobId,
      status: state, // 'completed', 'failed', 'delayed', 'active', 'waiting', etc.
      progress,
      message,
      resultUrl: returnvalue?.resultUrl,
      previewUrl: returnvalue?.previewUrl,
      previewId: returnvalue?.previewId,
      error: failedReason
    };
  }
}
