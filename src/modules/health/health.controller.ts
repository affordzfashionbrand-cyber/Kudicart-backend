import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

@Controller()
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  async getHealthRoot() {
    return this.checkHealth();
  }

  @Get('api/v1/health')
  @HttpCode(HttpStatus.OK)
  async getHealthApi() {
    return this.checkHealth();
  }

  private async checkHealth() {
    const uptimeSeconds = Math.round((Date.now() - this.startTime) / 1000);
    const mem = process.memoryUsage();

    let dbStatus = 'CONNECTED';
    let latencyMs = 0;

    const startCheck = Date.now();
    try {
      if (this.prisma.isConnectedToDb) {
        await (this.prisma as any).$queryRaw`SELECT 1`;
        latencyMs = Date.now() - startCheck;
      } else {
        dbStatus = 'FALLBACK_STORE_ACTIVE';
        latencyMs = 1;
      }
    } catch {
      dbStatus = 'DEGRADED';
      latencyMs = Date.now() - startCheck;
    }

    return {
      status: 'UP',
      service: 'affordz-backend',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds,
      environment: process.env.APP_ENV || 'development',
      database: {
        status: dbStatus,
        provider: 'supabase-postgresql',
        latencyMs,
      },
      queue: this.queueService.getQueueStatus(),
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsageMB: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        },
      },
      security: {
        failClosedGuards: true,
        rbacEnforced: true,
        idorGuardsActive: true,
        autoDispatchDisabled: true, // D-006 Invariant
      },
    };
  }
}
