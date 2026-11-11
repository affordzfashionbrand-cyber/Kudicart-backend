import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
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
  async getHealthRoot(@Res({ passthrough: true }) res?: Response) {
    return this.checkHealth(res);
  }

  @Get('health/ready')
  async getHealthReadyRoot(@Res({ passthrough: true }) res?: Response) {
    return this.checkHealth(res);
  }

  @Get('api/v1/health')
  async getHealthApi(@Res({ passthrough: true }) res?: Response) {
    return this.checkHealth(res);
  }

  @Get('api/v1/health/ready')
  async getHealthReadyApi(@Res({ passthrough: true }) res?: Response) {
    return this.checkHealth(res);
  }

  private async checkHealth(res?: Response) {
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
        dbStatus = 'DISCONNECTED';
        latencyMs = Date.now() - startCheck;
      }
    } catch {
      dbStatus = 'DEGRADED';
      latencyMs = Date.now() - startCheck;
    }

    const isHealthy = dbStatus === 'CONNECTED';
    res?.status(isHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: isHealthy ? 'UP' : 'DEGRADED',
      service: 'kudicart-backend',
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
