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

  describe('getRedisConnectionOptions', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('returns null when neither REDIS_HOST nor REDIS_URL is configured', () => {
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_URL;
      const { getRedisConnectionOptions } = require('./queue.constants');
      expect(getRedisConnectionOptions()).toBeNull();
    });

    it('correctly configures plain Redis with REDIS_HOST', () => {
      process.env.REDIS_HOST = '127.0.0.1';
      process.env.REDIS_PORT = '6379';
      delete process.env.REDIS_TLS;
      delete process.env.REDIS_PASSWORD;
      delete process.env.REDIS_URL;

      const { getRedisConnectionOptions } = require('./queue.constants');
      const config = getRedisConnectionOptions();

      expect(config).toBeDefined();
      expect(config?.host).toBe('127.0.0.1');
      expect(config?.port).toBe(6379);
      expect(config?.tls).toBeUndefined();
      expect(config?.maxRetriesPerRequest).toBeNull();
    });

    it('enables TLS and credentials when REDIS_TLS=true and credentials provided', () => {
      process.env.REDIS_HOST = 'kudicart-redis.production.cache.amazonaws.com';
      process.env.REDIS_PORT = '6380';
      process.env.REDIS_PASSWORD = 'super-secret-pass';
      process.env.REDIS_USERNAME = 'kudicart-app';
      process.env.REDIS_TLS = 'true';
      delete process.env.REDIS_URL;

      const { getRedisConnectionOptions } = require('./queue.constants');
      const config = getRedisConnectionOptions();

      expect(config).toBeDefined();
      expect(config?.host).toBe('kudicart-redis.production.cache.amazonaws.com');
      expect(config?.port).toBe(6380);
      expect(config?.password).toBe('super-secret-pass');
      expect(config?.username).toBe('kudicart-app');
      expect(config?.tls).toEqual({});
      expect(config?.maxRetriesPerRequest).toBeNull();
    });

    it('parses rediss:// TLS protocol from REDIS_URL', () => {
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_TLS;
      process.env.REDIS_URL = 'rediss://default:mypassword@redis-cloud.net:16379';

      const { getRedisConnectionOptions } = require('./queue.constants');
      const config = getRedisConnectionOptions();

      expect(config).toBeDefined();
      expect(config?.host).toBe('redis-cloud.net');
      expect(config?.port).toBe(16379);
      expect(config?.username).toBe('default');
      expect(config?.password).toBe('mypassword');
      expect(config?.tls).toEqual({});
      expect(config?.maxRetriesPerRequest).toBeNull();
    });

    it('parses plain redis:// protocol from REDIS_URL without TLS', () => {
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_TLS;
      process.env.REDIS_URL = 'redis://localhost:6379';

      const { getRedisConnectionOptions } = require('./queue.constants');
      const config = getRedisConnectionOptions();

      expect(config).toBeDefined();
      expect(config?.host).toBe('localhost');
      expect(config?.port).toBe(6379);
      expect(config?.tls).toBeUndefined();
      expect(config?.maxRetriesPerRequest).toBeNull();
    });
  });
});
