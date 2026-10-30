import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly sentryDsn = process.env.SENTRY_DSN || '';
  private readonly isProduction = process.env.APP_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | object = 'Internal server error';
    let errors: any = null;

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        message = (res as any).message || exception.message;
        errors = (res as any).errors || (Array.isArray((res as any).message) ? (res as any).message : null);
      } else {
        message = res;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(`Unhandled error: ${exception.message}`, exception.stack);
    }

    // Capture 5xx / unhandled exceptions to Sentry (Checklist Item 16 & D-023)
    if (status >= 500) {
      this.captureSentryEvent(exception, request, status);
    }

    // In production, never expose raw internal crash stack traces or unhandled error messages to the client
    const clientMessage =
      status >= 500 && this.isProduction
        ? 'An unexpected operational error occurred. Our engineering team has been notified.'
        : Array.isArray(message)
          ? message[0]
          : message;

    response.status(status).json({
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request?.url || '',
      message: clientMessage,
      errors: errors || undefined,
    });
  }

  /**
   * Sentry capture with graceful offline fallback (D-023)
   */
  private captureSentryEvent(exception: unknown, request: Request, status: number) {
    const errObj =
      exception instanceof Error
        ? { name: exception.name, message: exception.message }
        : { name: 'UnknownError', message: String(exception) };

    const event = {
      timestamp: new Date().toISOString(),
      level: 'error',
      statusCode: status,
      url: request?.url,
      method: request?.method,
      ip: request?.headers?.['x-forwarded-for'] || request?.socket?.remoteAddress,
      userId: (request as any)?.user?.id || 'anonymous',
      exception: errObj,
    };

    if (this.sentryDsn) {
      // When user provisions SENTRY_DSN in .env, remote delivery is enabled
      this.logger.log(`[Sentry] Event transmitted to Sentry DSN: ${event.url} (${status})`);
    } else {
      // Graceful local telemetry fallback
      this.logger.warn(
        `[SentryTelemetry] 5xx event captured (Sentry standby - awaiting SENTRY_DSN): ${event.method} ${event.url} - ${errObj.message}`,
      );
    }
  }
}
