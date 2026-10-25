import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';

interface RateRecord {
  timestamps: number[];
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private static records = new Map<string, RateRecord>();

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no rate limit decorator, allow request by default
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const response = typeof context.switchToHttp().getResponse === 'function'
      ? context.switchToHttp().getResponse()
      : null;

    // Determine client identifiers: authenticated user ID, remote IP, and phone number (if present in body)
    const user = request.user;
    const clientIp =
      request.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
      request.socket?.remoteAddress ||
      'anonymous-client';

    const keysToCheck: string[] = [];
    const identifier = user?.id ? `user:${user.id}` : `ip:${clientIp}`;
    keysToCheck.push(`${identifier}:${context.getClass().name}:${context.getHandler().name}`);

    const rawPhone = request.body?.phone || request.body?.phoneNumber;
    if (typeof rawPhone === 'string') {
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
      if (cleanPhone.length === 10) {
        keysToCheck.push(`phone:${cleanPhone}:${context.getClass().name}:${context.getHandler().name}`);
      }
    }

    const now = Date.now();
    const windowStart = now - options.duration * 1000;

    // Check all applicable keys (IP/user, phone)
    for (const key of keysToCheck) {
      let record = RateLimitGuard.records.get(key);
      if (!record) {
        record = { timestamps: [] };
        RateLimitGuard.records.set(key, record);
      }

      // Filter out expired timestamps
      record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

      if (record.timestamps.length >= options.points) {
        const oldestTimestamp = record.timestamps[0];
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((oldestTimestamp + options.duration * 1000 - now) / 1000),
        );

        if (response && response.setHeader) {
          response.setHeader('Retry-After', retryAfterSeconds.toString());
        }

        throw new HttpException(
          {
            success: false,
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Too many requests. Please retry after ${retryAfterSeconds} seconds.`,
            retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Record timestamp across all applicable keys
    for (const key of keysToCheck) {
      const record = RateLimitGuard.records.get(key);
      if (record) {
        record.timestamps.push(now);
      }
    }

    return true;
  }

  // Method to clear limits for testing
  static resetAll(): void {
    RateLimitGuard.records.clear();
  }
}
