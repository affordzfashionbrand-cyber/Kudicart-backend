import { Module } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';
import { MediaController } from './media.controller';

@Module({
  controllers: [MediaController],
  providers: [SupabaseStorageService],
  exports: [SupabaseStorageService],
})
export class MediaModule {}
