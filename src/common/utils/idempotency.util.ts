import { ConflictException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

export function hashIdempotencyPayload(payload: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload ?? {}))
    .digest('hex');
}

export async function runWithIdempotency<T>(
  prisma: PrismaService,
  params: {
    userId: string;
    scope: string;
    key?: string;
    payload: unknown;
    ttlMs?: number;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const cleanKey = params.key?.trim();
  if (!cleanKey || !prisma.isConnectedToDb) {
    return fn();
  }

  const requestHash = hashIdempotencyPayload(params.payload);
  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      userId_scope_key: {
        userId: params.userId,
        scope: params.scope,
        key: cleanKey,
      },
    },
  });

  if (existing && existing.expiresAt > new Date()) {
    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key was already used with a different request payload',
      );
    }
    return existing.responseBody as unknown as T;
  }

  const result = await fn();
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? 24 * 60 * 60 * 1000));

  await prisma.idempotencyKey
    .upsert({
      where: {
        userId_scope_key: {
          userId: params.userId,
          scope: params.scope,
          key: cleanKey,
        },
      },
      update: {
        requestHash,
        statusCode: 200,
        responseBody: result as any,
        expiresAt,
      },
      create: {
        userId: params.userId,
        scope: params.scope,
        key: cleanKey,
        requestHash,
        statusCode: 200,
        responseBody: result as any,
        expiresAt,
      },
    })
    .catch(() => undefined);

  return result;
}
