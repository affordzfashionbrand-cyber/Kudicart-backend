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

    // Log 5xx / unhandled exceptions locally to container stdout (DCR-016)
    if (status >= 500) {
      this.logServerException(exception, request, status);
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
   * Native structured error logging to stdout (AWS CloudWatch / container logs) per DCR-016
   */
  private logServerException(exception: unknown, request: Request, status: number) {
    const errMessage =
      exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;
    const userId = (request as any)?.user?.id || 'anonymous';
    const method = request?.method || 'UNKNOWN';
    const url = request?.url || '';

    this.logger.error(
      `[HTTP 5xx] ${method} ${url} (User: ${userId}, Status: ${status}) - ${errMessage}`,
      stack,
    );
  }
}
