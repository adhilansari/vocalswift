import { Controller, Post, UseInterceptors, UploadedFile, Get, Param, Res, HttpStatus, Body } from '@nestjs/common';
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

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        const randomName = uuidv4();
        cb(null, `${randomName}${extname(file.originalname)}`);
      }
    })
  }))
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Body('trimSilence') trimSilence?: string) {
    if (!file) {
      return { error: 'No file uploaded' };
    }
    
    const isTrimSilence = trimSilence === 'true';
    const job = await this.jobService.createJob(file.path, 'mp3', isTrimSilence);
    return job;
  }

  @Post('youtube')
  async submitYoutube(@Body('url') url: string, @Body('trimSilence') trimSilence?: boolean) {
    if (!url) {
      return { error: 'No YouTube URL provided' };
    }
    const job = await this.jobService.createYoutubeJob(url, trimSilence);
    return job;
  }

  @Get('status/:id')
  async getStatus(@Param('id') id: string) {
    return this.jobService.getJobStatus(id);
  }

  @Get('download/:id')
  async downloadResult(@Param('id') id: string, @Res() res: Response) {
    // The processor will save the result to a specific path
    const filePath = join(process.cwd(), 'results', `${id}.mp3`);
    
    if (!existsSync(filePath)) {
      return res.status(HttpStatus.NOT_FOUND).json({ error: 'File not found or not ready' });
    }
    
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': `attachment; filename="vocals-${id}.mp3"`,
    });
    
    const fileStream = createReadStream(filePath);
    fileStream.pipe(res);
  }

  @Post('trim/:id')
  async trimResult(@Param('id') id: string, @Body('start') start: number, @Body('end') end: number) {
    const filePath = join(process.cwd(), 'results', `${id}.mp3`);
    if (!existsSync(filePath)) {
      return { error: 'File not found' };
    }
    
    const trimmedId = `${id}_trimmed_${Math.floor(start)}_${Math.floor(end)}`;
    const trimmedPath = join(process.cwd(), 'results', `${trimmedId}.mp3`);
    
    try {
      // Use ffmpeg to trim
      // Note: re-encoding audio slightly to ensure exact trim
      await execAsync(`ffmpeg -y -i "${filePath}" -ss ${start} -to ${end} "${trimmedPath}"`);
      return { resultUrl: `/api/jobs/download/${trimmedId}` };
    } catch (e) {
      console.error(e);
      return { error: 'Trim failed' };
    }
  }
  @Post('trim-silence/:id')
  async trimSilenceResult(@Param('id') id: string) {
    const filePath = join(process.cwd(), 'results', `${id}.mp3`);
    if (!existsSync(filePath)) {
      return { error: 'File not found' };
    }
    
    const trimmedId = `${id}_notrim`;
    const trimmedPath = join(process.cwd(), 'results', `${trimmedId}.mp3`);
    
    try {
      // Use ffmpeg to remove silence from both ends
      await execAsync(`ffmpeg -y -i "${filePath}" -af "silenceremove=start_periods=1:start_duration=0.5:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_duration=0.5:start_threshold=-50dB,areverse" "${trimmedPath}"`);
      return { resultUrl: `/api/jobs/download/${trimmedId}` };
    } catch (e) {
      console.error(e);
      return { error: 'Silence trim failed' };
    }
  }
}
