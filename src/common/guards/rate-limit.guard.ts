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

    // Determine client identifier: authenticated user ID or remote IP address
    const user = request.user;
    const clientIp =
      request.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
      request.socket?.remoteAddress ||
      'anonymous-client';

    const identifier = user?.id ? `user:${user.id}` : `ip:${clientIp}`;
    const key = `${identifier}:${context.getClass().name}:${context.getHandler().name}`;

    const now = Date.now();
    const windowStart = now - options.duration * 1000;

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

    record.timestamps.push(now);
    return true;
  }

  // Method to clear limits for testing
  static resetAll(): void {
    RateLimitGuard.records.clear();
  }
}
