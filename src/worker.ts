import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';
import { OutboxService } from './modules/queue/outbox.service';
import { QueueService } from './modules/queue/queue.service';

async function bootstrap() {
  const logger = new Logger('AffordzWorkerBootstrap');
  logger.log('Starting Affordz Background Job & Outbox Worker Process...');

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });

  const outboxService = app.get(OutboxService);
  const queueService = app.get(QueueService);

  const queueStatus = queueService.getQueueStatus();
  logger.log(
    `Worker status: Redis Configured = ${queueStatus.redisConfigured}, Connected = ${queueStatus.isRedisConnected}`,
  );
  logger.log(`Active Worker Queues: ${queueStatus.activeQueues.join(', ')}`);

  // Start polling outbox events to publish to BullMQ
  const outboxInterval = setInterval(async () => {
    try {
      const res = await outboxService.dispatchPendingEvents();
      if (res.processedCount > 0) {
        logger.log(`Outbox Dispatcher processed ${res.processedCount} event(s)`);
      }
    } catch (err: any) {
      logger.error(`Outbox dispatcher cycle error: ${err.message}`);
    }
  }, 10000);

  // Graceful shutdown handling
  const handleShutdown = async (signal: string) => {
    logger.log(`Received ${signal}. Shutting down worker process gracefully...`);
    clearInterval(outboxInterval);
    await app.close();
    logger.log('Worker process exited cleanly.');
    process.exit(0);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  logger.log('Affordz Worker Process is active, resilient, and ready for jobs.');
}

bootstrap().catch((err) => {
  console.error('Fatal Worker bootstrap error:', err);
  process.exit(1);
});

