import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { OrdersDomainModule } from './modules/orders/orders-domain.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { QueueModule } from './modules/queue/queue.module';

@Module({
  imports: [
    PrismaModule,
    OrdersDomainModule,
    NotificationsModule,
    QueueModule,
  ],
})
export class WorkerModule {}
