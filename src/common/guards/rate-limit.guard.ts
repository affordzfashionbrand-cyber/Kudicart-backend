import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Optional,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';
import { RedisService } from '../redis/redis.service';

interface RateRecord {
  timestamps: number[];
}

const SENSITIVE_OPERATION_PATTERNS = [
  /auth/i,
  /login/i,
  /otp/i,
  /password/i,
  /payment/i,
  /checkout/i,
  /admin/i,
];

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private static records = new Map<string, RateRecord>();
  private static globalRedisService?: RedisService;

  constructor(
    private reflector: Reflector,
    @Optional() private readonly redisService?: RedisService,
  ) {
    if (redisService) {
      RateLimitGuard.globalRedisService = redisService;
    }
  }

  private resolveClientIp(request: any): string {
    const directIp =
      request.socket?.remoteAddress ||
      request.connection?.remoteAddress ||
      '127.0.0.1';

    // Verify whether the direct connection is from a trusted local proxy
    const isLocalOrPrivateProxy =
      directIp === '127.0.0.1' ||
      directIp === '::1' ||
      directIp === '::ffff:127.0.0.1' ||
      directIp.startsWith('10.') ||
      directIp.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(directIp);

    if (isLocalOrPrivateProxy && request.headers) {
      const forwarded = request.headers['x-forwarded-for'];
      if (typeof forwarded === 'string' && forwarded.trim()) {
        const clientIp = forwarded.split(',')[0].trim();
        if (clientIp) return clientIp;
      }
      const realIp = request.headers['x-real-ip'];
      if (typeof realIp === 'string' && realIp.trim()) {
        return realIp.trim();
      }
    }

    return directIp;
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no rate limit decorator, allow request by default
    if (!options) {
      return true;
    }

    const effectiveRedis = this.redisService || RateLimitGuard.globalRedisService;

    // Execute async when running with real Redis
    if (
      effectiveRedis &&
      typeof effectiveRedis.isUsingRealRedis === 'function' &&
      effectiveRedis.isUsingRealRedis()
    ) {
      return this.checkRateLimitAsync(context, options, effectiveRedis);
    }

    // Execute synchronously for in-memory bus and unit tests
    return this.checkRateLimitSync(context, options, effectiveRedis);
  }

  private checkRateLimitSync(
    context: ExecutionContext,
    options: RateLimitOptions,
    effectiveRedis?: RedisService,
  ): boolean {
    const request = context.switchToHttp().getRequest();
    const response =
      typeof context.switchToHttp().getResponse === 'function'
        ? context.switchToHttp().getResponse()
        : null;

    const user = request.user;
    const clientIp = this.resolveClientIp(request);
    const className = context.getClass().name;
    const handlerName = context.getHandler().name;

    const keysToCheck: string[] = [];
    const identifier = user?.id ? `user:${user.id}` : `ip:${clientIp}`;
    keysToCheck.push(`${identifier}:${className}:${handlerName}`);

    const rawPhone = request.body?.phone || request.body?.phoneNumber;
    if (typeof rawPhone === 'string') {
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
      if (cleanPhone.length === 10) {
        keysToCheck.push(`phone:${cleanPhone}:${className}:${handlerName}`);
      }
    }

    // If effectiveRedis in-memory bus is available, use it synchronously
    if (effectiveRedis && typeof effectiveRedis.checkRateLimitSync === 'function') {
      for (const key of keysToCheck) {
        const res = effectiveRedis.checkRateLimitSync(
          key,
          options.points,
          options.duration,
        );

        if (!res.allowed) {
          if (response && typeof response.setHeader === 'function') {
            response.setHeader('Retry-After', res.retryAfterSeconds.toString());
          }

          throw new HttpException(
            {
              success: false,
              statusCode: HttpStatus.TOO_MANY_REQUESTS,
              message: `Too many requests. Please retry after ${res.retryAfterSeconds} seconds.`,
              retryAfterSeconds: res.retryAfterSeconds,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }
      return true;
    }

    // Fallback to static records map
    const now = Date.now();
    const windowStart = now - options.duration * 1000;

    for (const key of keysToCheck) {
      let record = RateLimitGuard.records.get(key);
      if (!record) {
        record = { timestamps: [] };
        RateLimitGuard.records.set(key, record);
      }

      record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

      if (record.timestamps.length >= options.points) {
        const oldestTimestamp = record.timestamps[0];
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((oldestTimestamp + options.duration * 1000 - now) / 1000),
        );

        if (response && typeof response.setHeader === 'function') {
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

    for (const key of keysToCheck) {
      const record = RateLimitGuard.records.get(key);
      if (record) {
        record.timestamps.push(now);
      }
    }

    return true;
  }

  private async checkRateLimitAsync(
    context: ExecutionContext,
    options: RateLimitOptions,
    effectiveRedis: RedisService,
  ): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response =
      typeof context.switchToHttp().getResponse === 'function'
        ? context.switchToHttp().getResponse()
        : null;

    const user = request.user;
    const clientIp = this.resolveClientIp(request);
    const className = context.getClass().name;
    const handlerName = context.getHandler().name;
    const isSensitive = SENSITIVE_OPERATION_PATTERNS.some(
      (pat) => pat.test(className) || pat.test(handlerName),
    );

    const keysToCheck: string[] = [];
    const identifier = user?.id ? `user:${user.id}` : `ip:${clientIp}`;
    keysToCheck.push(`${identifier}:${className}:${handlerName}`);

    const rawPhone = request.body?.phone || request.body?.phoneNumber;
    if (typeof rawPhone === 'string') {
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
      if (cleanPhone.length === 10) {
        keysToCheck.push(`phone:${cleanPhone}:${className}:${handlerName}`);
      }
    }

    try {
      for (const key of keysToCheck) {
        const res = await effectiveRedis.checkRateLimit(
          key,
          options.points,
          options.duration,
        );

        if (!res.allowed) {
          if (response && typeof response.setHeader === 'function') {
            response.setHeader('Retry-After', res.retryAfterSeconds.toString());
          }

          throw new HttpException(
            {
              success: false,
              statusCode: HttpStatus.TOO_MANY_REQUESTS,
              message: `Too many requests. Please retry after ${res.retryAfterSeconds} seconds.`,
              retryAfterSeconds: res.retryAfterSeconds,
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }
      return true;
    } catch (err: any) {
      if (err instanceof HttpException) {
        throw err;
      }

      // Redis Failure Policy
      const isProduction =
        process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';
      if (isProduction && isSensitive) {
        this.logger.error(
          `RateLimitGuard: Distributed rate limiter failed on sensitive endpoint ${className}.${handlerName}: ${err.message}. Failing closed for security.`,
        );
        throw new HttpException(
          {
            success: false,
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            message: 'Rate limiting service temporarily unavailable. Please retry shortly.',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      this.logger.warn(
        `RateLimitGuard: Redis error on ${className}.${handlerName} (${err.message}). Bounded local fallback activated.`,
      );

      // Execute synchronous fallback
      return this.checkRateLimitSync(context, options);
    }
  }

  static resetAll(): void {
    RateLimitGuard.records.clear();
    if (
      RateLimitGuard.globalRedisService &&
      typeof RateLimitGuard.globalRedisService.resetInMemoryState === 'function'
    ) {
      RateLimitGuard.globalRedisService.resetInMemoryState();
    }
  }
}
