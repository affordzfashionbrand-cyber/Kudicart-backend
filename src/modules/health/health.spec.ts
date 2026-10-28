import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../../prisma/prisma.service';

describe('HealthController (Item 20 in Go-Live Release Gate)', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [PrismaService],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return HTTP 200 with UP status on root /health', async () => {
    const res = await controller.getHealthRoot();
    expect(res).toBeDefined();
    expect(res.status).toBe('UP');
    expect(res.service).toBe('affordz-backend');
    expect(res.database).toBeDefined();
    expect(res.security.failClosedGuards).toBe(true);
    expect(res.security.autoDispatchDisabled).toBe(true);
  });

  it('should return system telemetry and memory on /api/v1/health', async () => {
    const res = await controller.getHealthApi();
    expect(res.status).toBe('UP');
    expect(typeof res.uptimeSeconds).toBe('number');
    expect(res.system).toBeDefined();
    expect(res.system.memoryUsageMB).toBeDefined();
  });
});
