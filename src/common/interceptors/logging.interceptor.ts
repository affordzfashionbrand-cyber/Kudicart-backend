import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Sensitive field keys that must ALWAYS be redacted from application logs
 * Satisfies OWASP ASVS and Go-Live Release Gate Item 8
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'idtoken',
  'refreshtoken',
  'authorization',
  'secret',
  'keysecret',
  'webhooksecret',
  'cvv',
  'cardnumber',
  'card_number',
  'pan',
  'accountnumber',
  'account_number',
  'otp',
  'code',
  'verificationcode',
  'signature',
]);

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    if (!request) {
      return next.handle();
    }

    const { method, url } = request;
    const clientIp =
      request.headers?.['x-forwarded-for']?.toString().split(',')[0].trim() ||
      request.socket?.remoteAddress ||
      'anonymous-ip';
    const userId = request.user?.id || 'anonymous';
    const startTime = Date.now();

    // Sanitize request body and query before logging
    const sanitizedBody = this.sanitize(request.body);
    const sanitizedQuery = this.sanitize(request.query);

    this.logger.log(
      `--> [REQ] ${method} ${url} | IP: ${clientIp} | User: ${userId}` +
        (sanitizedBody && Object.keys(sanitizedBody).length > 0
          ? ` | Body: ${JSON.stringify(sanitizedBody)}`
          : '') +
        (sanitizedQuery && Object.keys(sanitizedQuery).length > 0
          ? ` | Query: ${JSON.stringify(sanitizedQuery)}`
          : ''),
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const response = context.switchToHttp().getResponse();
          const statusCode = response?.statusCode || 200;
          this.logger.log(
            `<-- [RES] ${method} ${url} ${statusCode} +${duration}ms`,
          );
        },
        error: (err) => {
          const duration = Date.now() - startTime;
          const status = err.status || err.statusCode || 500;
          const sanitizedErr = this.sanitize(err.message || 'Internal error');
          this.logger.warn(
            `<-- [ERR] ${method} ${url} ${status} +${duration}ms - ${sanitizedErr}`,
          );
        },
      }),
    );
  }

  /**
   * Deep recursive sanitization of payloads, objects, arrays, and strings
   */
  public sanitize(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      return this.sanitizeString(data);
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitize(item));
    }

    if (typeof data === 'object') {
      const sanitizedObj: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        const lowerKey = key.toLowerCase().replace(/[^a-z]/g, '');
        if (SENSITIVE_KEYS.has(lowerKey)) {
          sanitizedObj[key] = '[REDACTED]';
        } else {
          sanitizedObj[key] = this.sanitize(value);
        }
      }
      return sanitizedObj;
    }

    return data;
  }

  /**
   * Mask emails, phone numbers, and potential card numbers in strings
   */
  private sanitizeString(str: string): string {
    // 1. Redact JWT tokens (Bearer eyJ...)
    let res = str.replace(/Bearer\s+eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/gi, 'Bearer [REDACTED_JWT]');

    // 2. Redact 16-digit credit card patterns
    res = res.replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '****-****-****-[REDACTED]');

    // 3. Mask Indian 10-digit phone numbers: 9845012890 -> 98450*****
    res = res.replace(/\b(?:\+?91[\s-]?)?(\d{5})(\d{5})\b/g, '$1*****');

    // 4. Mask email addresses: user@domain.com -> u***r@domain.com
    res = res.replace(/\b([a-zA-Z0-9_.+-])[a-zA-Z0-9_.+-]*([a-zA-Z0-9_.+-])@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\b/g, '$1***$2@$3');

    return res;
  }
}
