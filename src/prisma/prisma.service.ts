import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Redacts sensitive credentials, passwords, tokens and secrets from audit payloads.
 */
function sanitizeAuditPayload(data?: Record<string, any>): Record<string, any> | undefined {
  if (!data || typeof data !== 'object') return data;
  const sensitiveKeys = new Set([
    'password',
    'token',
    'accesstoken',
    'refreshtoken',
    'idtoken',
    'secret',
    'jwt',
    'jwtsecret',
    'authorization',
    'creditcard',
    'cardnumber',
    'cvv',
    'otp',
    'pin',
  ]);

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase().replace(/[^a-z]/g, '');
    if (sensitiveKeys.has(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeAuditPayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  public isConnectedToDb = false;

  async onModuleInit() {
    const isProduction =
      process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';

    if (process.env.DATABASE_URL) {
      try {
        await this.$connect();
        this.isConnectedToDb = true;
        this.logger.log('PrismaService: Successfully connected to PostgreSQL database.');
      } catch (err: any) {
        if (isProduction) {
          throw new Error(
            `FATAL: PostgreSQL database connection failed in production mode: ${err.message}`,
          );
        }
        this.logger.warn(
          `PrismaService: PostgreSQL connection failed (${err.message}) in development/test mode.`,
        );
      }
    } else {
      if (isProduction) {
        throw new Error(
          'FATAL: DATABASE_URL environment variable is strictly required in production mode',
        );
      }
      this.logger.warn('PrismaService: DATABASE_URL unset in development/test mode.');
    }
  }

  async onModuleDestroy() {
    if (this.isConnectedToDb) {
      await this.$disconnect();
    }
  }

  /**
   * Persists an enterprise audit event directly into the PostgreSQL AuditLog table.
   * Redacts sensitive payload credentials and enforces honest database error handling.
   */
  async recordAuditEvent(event: {
    actorId?: string;
    actorName?: string;
    actorRole?: string;
    actionType: string;
    entityId: string;
    entityName?: string;
    entityType: string;
    ipAddress?: string;
    userAgent?: string;
    summary: string;
    targetDescription?: string;
    changePayload?: Record<string, any>;
    entityLink?: string;
  }) {
    const sanitizedPayload = sanitizeAuditPayload(event.changePayload);
    const actorName = event.actorName || 'Operations Admin';
    const actorRole = event.actorRole || 'ADMIN';
    const actorId = event.actorId || 'ADM-001';

    const detailsObj = {
      summary: event.summary,
      entityName: event.entityName || event.entityId,
      targetDescription: event.targetDescription || `${event.entityType} ${event.entityId}`,
      changePayload: sanitizedPayload || {},
      entityLink: event.entityLink,
      userAgent: event.userAgent,
    };

    if (!this.isConnectedToDb) {
      this.logger.warn(
        `PrismaService.recordAuditEvent: Database not connected. Audit event for ${event.entityType} ${event.entityId} cannot be persisted.`,
      );
      return {
        id: `AUD-UNSAVED-${Date.now()}`,
        actorId,
        actorName,
        actorRole,
        actionType: event.actionType,
        entityId: event.entityId,
        entityType: event.entityType,
        summary: event.summary,
        createdAt: new Date(),
      };
    }

    try {
      const record = await this.auditLog.create({
        data: {
          userId: actorId,
          userEmail: actorName,
          userRole: actorRole,
          action: event.actionType,
          entityType: event.entityType,
          entityId: event.entityId,
          details: JSON.stringify(detailsObj),
          ipAddress: event.ipAddress || '127.0.0.1',
        },
      });

      return {
        id: record.id,
        actorId: record.userId,
        actorName: record.userEmail,
        actorRole: record.userRole,
        actionType: record.action,
        entityId: record.entityId,
        entityType: record.entityType,
        summary: event.summary,
        createdAt: record.createdAt,
      };
    } catch (err: any) {
      this.logger.error(
        `PrismaService.recordAuditEvent: Failed to persist audit record for ${event.entityType} ${event.entityId}: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }
}
