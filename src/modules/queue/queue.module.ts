import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { OutboxService } from './outbox.service';
import { NotificationsProcessor } from './processors/notifications.processor';
import { PaymentsProcessor } from './processors/payments.processor';

@Global()
@Module({
  providers: [
    QueueService,
    OutboxService,
    NotificationsProcessor,
    PaymentsProcessor,
  ],
  exports: [
    QueueService,
    OutboxService,
    NotificationsProcessor,
    PaymentsProcessor,
  ],
})
export class QueueModule {}
