import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from './queue.service';
import { QueueJobType } from './queue.constants';

describe('QueueService', () => {
  let moduleRef: TestingModule;
  let queueService: QueueService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [QueueService],
    }).compile();

    queueService = moduleRef.get<QueueService>(QueueService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('reports active BullMQ queues and Redis connectivity flags', async () => {
    const status = await queueService.getQueueStatus();

    expect(typeof status.redisConfigured).toBe('boolean');
    expect(typeof status.isRedisConnected).toBe('boolean');
    expect(Array.isArray(status.activeQueues)).toBe(true);
    expect(status.activeQueues.length).toBeGreaterThanOrEqual(2);
  });

  it('enqueues notification jobs with queue metadata and job id', async () => {
    const status = await queueService.getQueueStatus();
    const result = await queueService.enqueueNotification(
      QueueJobType.ORDER_STATUS_NOTIFICATION,
      { orderId: 'ord-queue-test', customerId: 'usr-1' },
    );

    expect(result.id).toBeDefined();
    expect(result.type).toBe(QueueJobType.ORDER_STATUS_NOTIFICATION);
    expect(status.activeQueues).toContain(result.queue);
    expect(['queued', 'queued-in-process']).toContain(result.status);
  });

  it('enqueues delayed payment expiry jobs and preserves scheduledDelayMs', async () => {
    const status = await queueService.getQueueStatus();
    const delayMs = 15 * 60 * 1000;
    const result = await queueService.enqueuePaymentJob(
      QueueJobType.ORDER_EXPIRY_CHECK,
      { orderId: 'ord-expiry-test' },
      { delayMs },
    );

    expect(result.id).toBeDefined();
    expect(result.type).toBe(QueueJobType.ORDER_EXPIRY_CHECK);
    expect(status.activeQueues).toContain(result.queue);
    expect(result.scheduledDelayMs).toBe(delayMs);
    expect(['queued', 'queued-in-process']).toContain(result.status);
  });
});
