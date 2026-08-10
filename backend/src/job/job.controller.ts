import { Controller, Post, UseInterceptors, UploadedFile, Get, Param, Res, HttpStatus, Body, Sse } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JobService } from './job.service';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

@Controller('api/jobs')
export class JobController {
  constructor(private readonly jobService: JobService) {}

  @Post('upload-preview')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const randomName = uuidv4();
        cb(null, `${randomName}${extname(file.originalname)}`);
      }
    })
  }))
  async uploadPreviewFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      return { error: 'No file uploaded' };
    }
    
    return {
      previewId: file.filename,
      previewUrl: `/api/jobs/preview/${file.filename}`,
      status: 'completed'
    };
  }

  @Get('preview/:filename')
  async getPreviewFile(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = join(process.cwd(), 'uploads', filename);
    if (!existsSync(filePath)) {
      return res.status(HttpStatus.NOT_FOUND).json({ error: 'File not found' });
    }
    res.set({
      'Content-Type': 'audio/mpeg',
    });
    const fileStream = createReadStream(filePath);
    fileStream.pipe(res);
  }

  @Post('youtube-preview')
  async submitYoutubePreview(@Body('url') url: string) {
    if (!url) {
      return { error: 'No YouTube URL provided' };
    }
    const job = await this.jobService.createYoutubePreviewJob(url);
    return job;
  }

  @Post('isolate')
  async isolateAudio(
    @Body('fileId') fileId: string,
    @Body('isYoutube') isYoutube: boolean,
    @Body('trimSilence') trimSilence?: boolean,
    @Body('minGapSeconds') minGapSeconds?: number,
    @Body('normalize') normalize?: boolean,
    @Body('outputFormat') outputFormat?: string,
    @Body('start') start?: number,
    @Body('end') end?: number,
    @Body('fastMode') fastMode?: boolean,
    @Body('originalName') originalName?: string
  ) {
    if (!fileId) return { error: 'No fileId provided' };

    let targetFilePath = join(process.cwd(), 'uploads', isYoutube ? `${fileId}.mp3` : fileId);

    // If it's a youtube preview, NestJS might not have it locally yet!
    if (isYoutube && !existsSync(targetFilePath)) {
       // Download from Python service
       const fetch = require('node-fetch');
       const { pipeline } = require('stream/promises');
       const fs = require('fs');
       const res = await fetch(`http://localhost:8000/raw-download/${fileId}`);
       if (!res.ok) return { error: 'Failed to fetch youtube preview from separation service' };
       await pipeline(res.body, fs.createWriteStream(targetFilePath));
    }

    // Trim it if requested
    if (start !== undefined && end !== undefined) {
      const trimmedPath = join(process.cwd(), 'uploads', `trimmed_${fileId}.mp3`);
      try {
        await execAsync(`ffmpeg -y -i "${targetFilePath}" -ss ${start} -to ${end} "${trimmedPath}"`);
        targetFilePath = trimmedPath; // Use the trimmed file
      } catch (e) {
         console.error('Trim error:', e);
         return { error: 'Failed to trim audio before isolation' };
      }
    }

    // Now we create the separation job!
    const job = await this.jobService.createJob(
      targetFilePath, 
      outputFormat || 'mp3', 
      !!trimSilence,
      minGapSeconds ?? 3.0,
      normalize ?? true,
      !!fastMode,
      originalName
    );
    return job;
  }

  @Get('history')
  async getHistory() {
    return this.jobService.getHistory();
  }

  @Get('status/:id')
  async getStatus(@Param('id') id: string) {
    return this.jobService.getJobStatus(id);
  }

  @Sse('events/:id')
  getEvents(@Param('id') id: string): any {
    const { Observable, interval } = require('rxjs');
    const { switchMap, takeWhile, filter, map } = require('rxjs/operators');
    
    let lastStatus = '';
    let lastProgress = -1;
    let lastMessage = '';
    
    return interval(1000).pipe(
      switchMap(async () => {
        return await this.jobService.getJobStatus(id);
      }),
      takeWhile((status: any) => status.status !== 'completed' && status.status !== 'failed' && status.status !== 'not_found', true),
      filter((status: any) => {
         const progObj = status.progress as any;
         const progNum = progObj ? (typeof progObj === 'number' ? progObj : progObj.percent) : 0;
         const progMsg = progObj && progObj.message ? progObj.message : '';
         if (status.status !== lastStatus || progNum !== lastProgress || progMsg !== lastMessage) {
            lastStatus = status.status;
            lastProgress = progNum;
            lastMessage = progMsg;
            return true;
         }
         return false;
      }),
      map((status: any) => {
        return { data: status };
      })
    );
  }

  @Get('download/:id')
  async downloadResult(@Param('id') id: string, @Res() res: Response) {
    const mp3Path = join(process.cwd(), 'results', `${id}.mp3`);
    const wavPath = join(process.cwd(), 'results', `${id}.wav`);
    
    let filePath = mp3Path;
    let format = 'mp3';
    let contentType = 'audio/mpeg';

    if (existsSync(mp3Path)) {
        filePath = mp3Path;
    } else if (existsSync(wavPath)) {
        filePath = wavPath;
        format = 'wav';
        contentType = 'audio/wav';
    } else {
      return res.status(HttpStatus.NOT_FOUND).json({ error: 'File not found or not ready' });
    }
    
    const job = await this.jobService.getRawJob(id);
    let originalName = 'vocals';
    if (job && job.data) {
       originalName = job.data.isYoutube ? 'youtube_audio' : (job.data.originalName || 'vocals');
    }
    originalName = originalName.replace(/\.[^/.]+$/, "");
    
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${originalName}_VF.${format}"`,
    });
    
    const fileStream = createReadStream(filePath);
    fileStream.pipe(res);
  }

  @Post('trim/:id')
  async trimResult(@Param('id') id: string, @Body('start') start: number, @Body('end') end: number) {
    const mp3Path = join(process.cwd(), 'results', `${id}.mp3`);
    const wavPath = join(process.cwd(), 'results', `${id}.wav`);
    
    let filePath = mp3Path;
    let format = 'mp3';
    if (existsSync(mp3Path)) {
        filePath = mp3Path;
    } else if (existsSync(wavPath)) {
        filePath = wavPath;
        format = 'wav';
    } else {
      return { error: 'File not found' };
    }
    
    const trimmedId = `${id}_trimmed_${Math.floor(start)}_${Math.floor(end)}`;
    const trimmedPath = join(process.cwd(), 'results', `${trimmedId}.${format}`);
    
    try {
      await execAsync(`ffmpeg -y -i "${filePath}" -ss ${start} -to ${end} "${trimmedPath}"`);
      return { resultUrl: `/api/jobs/download/${trimmedId}` };
    } catch (e) {
      console.error(e);
      return { error: 'Trim failed' };
    }
  }
  @Post('trim-silence/:id')
  async trimSilenceResult(@Param('id') id: string) {
    const mp3Path = join(process.cwd(), 'results', `${id}.mp3`);
    const wavPath = join(process.cwd(), 'results', `${id}.wav`);
    
    let filePath = mp3Path;
    let format = 'mp3';
    if (existsSync(mp3Path)) {
        filePath = mp3Path;
    } else if (existsSync(wavPath)) {
        filePath = wavPath;
        format = 'wav';
    } else {
      return { error: 'File not found' };
    }
    
    const trimmedId = `${id}_notrim`;
    const trimmedPath = join(process.cwd(), 'results', `${trimmedId}.${format}`);
    
    try {
      await execAsync(`ffmpeg -y -i "${filePath}" -af "silenceremove=start_periods=1:start_duration=0.5:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_duration=0.5:start_threshold=-50dB,areverse" "${trimmedPath}"`);
      return { resultUrl: `/api/jobs/download/${trimmedId}` };
    } catch (e) {
      console.error(e);
      return { error: 'Silence trim failed' };
    }
  }
  @Post('cut/:id')
  async cutResult(@Param('id') id: string, @Body('start') start: number, @Body('end') end: number) {
    const mp3Path = join(process.cwd(), 'results', `${id}.mp3`);
    const wavPath = join(process.cwd(), 'results', `${id}.wav`);
    
    let filePath = mp3Path;
    let format = 'mp3';
    if (existsSync(mp3Path)) {
        filePath = mp3Path;
    } else if (existsSync(wavPath)) {
        filePath = wavPath;
        format = 'wav';
    } else {
      return { error: 'File not found' };
    }
    
    const cutId = `${id}_cut_${Math.floor(start)}_${Math.floor(end)}`;
    const cutPath = join(process.cwd(), 'results', `${cutId}.${format}`);
    
    try {
      if (start <= 0.1) {
        // If cut starts at 0, just trim from `end` to end of file
        await execAsync(`ffmpeg -y -i "${filePath}" -ss ${end} "${cutPath}"`);
      } else {
        // Cut out the middle portion and concat the rest
        const filter = `[0:a]atrim=start=0:end=${start},asetpts=PTS-STARTPTS[part1];[0:a]atrim=start=${end},asetpts=PTS-STARTPTS[part2];[part1][part2]concat=n=2:v=0:a=1[out]`;
        await execAsync(`ffmpeg -y -i "${filePath}" -filter_complex "${filter}" -map "[out]" "${cutPath}"`);
      }
      return { resultUrl: `/api/jobs/download/${cutId}` };
    } catch (e) {
      console.error('Cut failed:', e);
      return { error: 'Cut failed' };
    }
  }
}
