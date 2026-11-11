import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request = require('supertest');
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersDomainModule } from '../orders/orders-domain.module';
import { TrackingModule } from '../orders/tracking.module';
import { QueueModule } from '../queue/queue.module';
import { HealthController } from './health.controller';

describe('Health & Readiness Endpoints', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        NotificationsModule,
        TrackingModule,
        OrdersDomainModule,
        QueueModule,
      ],
      controllers: [HealthController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await moduleRef?.close();
  });

  it('GET /health returns service identity, PostgreSQL connectivity, and queue status', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body.status).toBe('UP');
    expect(res.body.service).toBe('kudicart-backend');
    expect(res.body.database).toMatchObject({
      provider: 'supabase-postgresql',
      status: 'CONNECTED',
    });
    expect(res.body.queue).toBeDefined();
    expect(typeof res.body.queue.redisConfigured).toBe('boolean');
    expect(typeof res.body.queue.isRedisConnected).toBe('boolean');
    expect(Array.isArray(res.body.queue.activeQueues)).toBe(true);
    expect(res.body.queue.activeQueues.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/v1/health mirrors health payload for versioned probes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(res.body.service).toBe('kudicart-backend');
    expect(res.body.database).toMatchObject({
      provider: 'supabase-postgresql',
      status: 'CONNECTED',
    });
  });

  it('GET /health/ready and /api/v1/health/ready verify PostgreSQL readiness', async () => {
    const readyRes = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(readyRes.body.database).toMatchObject({
      provider: 'supabase-postgresql',
      status: 'CONNECTED',
    });
    expect(['UP', 'READY']).toContain(readyRes.body.status);

    const v1ReadyRes = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(v1ReadyRes.body.database).toMatchObject({
      provider: 'supabase-postgresql',
      status: 'CONNECTED',
    });
    expect(['UP', 'READY']).toContain(v1ReadyRes.body.status);
  });
});
