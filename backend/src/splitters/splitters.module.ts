import { Module } from '@nestjs/common';
import { SplittersService } from './splitters.service';

@Module({
  providers: [SplittersService],
  exports: [SplittersService],
})
export class SplittersModule {}