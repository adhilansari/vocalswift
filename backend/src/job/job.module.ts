import { Module } from '@nestjs/common';
import { JobService } from './job.service';
import { JobController } from './job.controller';
import { BullModule } from '@nestjs/bullmq';
import { AudioJobProcessor } from './job.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'audio-separation',
    }),
  ],
  providers: [JobService, AudioJobProcessor],
  controllers: [JobController],
})
export class JobModule {}
