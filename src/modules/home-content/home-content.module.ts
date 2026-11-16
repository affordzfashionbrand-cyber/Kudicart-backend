import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';
import { HomeContentController } from './home-content.controller';
import { AdminHomeContentController } from './admin-home-content.controller';
import { HomeContentService } from './home-content.service';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [HomeContentController, AdminHomeContentController],
  providers: [HomeContentService],
  exports: [HomeContentService],
})
export class HomeContentModule {}
