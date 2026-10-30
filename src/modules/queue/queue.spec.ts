import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from './queue.service';
import { QueueJobType } from './queue.constants';

describe('QueueService (BullMQ & Redis D-027)', () => {
  let queueService: QueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QueueService],
    }).compile();

    queueService = module.get<QueueService>(QueueService);
  });

  afterEach(async () => {
    await queueService.onModuleDestroy();
  });

  it('initializes in standby mode with in-process fallback when Redis is offline', () => {
    const status = queueService.getQueueStatus();
    expect(status.provider).toBe('BullMQ');
    expect(status.activeQueues.length).toBe(2);
  });

  it('enqueues notification job via async fallback without throwing', async () => {
    const res = await queueService.enqueueNotification(
      QueueJobType.ORDER_STATUS_NOTIFICATION,
      { orderId: 'ord-101', status: 'ACCEPTED', userId: 'usr-1' },
    );

    expect(res.queued).toBe(true);
    expect(res.jobId).toBeDefined();
    expect(res.type).toBe(QueueJobType.ORDER_STATUS_NOTIFICATION);
  });

  it('enqueues payment reconciliation job without throwing', async () => {
    const res = await queueService.enqueuePaymentReconciliation('ord-101', 500);

    expect(res.queued).toBe(true);
    expect(res.jobId).toBeDefined();
  });
});
