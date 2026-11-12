import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { validateJwtSecret } from './common/utils/crypto.util';

async function bootstrap() {
  const logger = new Logger('AffordzBackend');
  const isProduction =
    process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';

  // Strict startup configuration validation for production
  if (isProduction) {
    logger.log('Validating production environment configuration...');
    if (!process.env.DATABASE_URL) {
      throw new Error('FATAL: DATABASE_URL environment variable is strictly required in production mode');
    }
    validateJwtSecret();
  }

  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    });
  }

  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Explicit permitted browser origins (Admin, Vendor web applications)
  const defaultDevOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3002',
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    'http://localhost:19006',
  ];

  const defaultProdOrigins = [
    'https://kudicart.com',
    'https://admin.kudicart.com',
    'https://vendor.kudicart.com',
    'https://affordz.com',
    'https://admin.affordz.com',
    'https://vendor.affordz.com',
  ];

  const configuredOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : [];

  const permittedOrigins = new Set(
    configuredOrigins.length > 0
      ? configuredOrigins
      : isProduction
        ? defaultProdOrigins
        : defaultDevOrigins,
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Requests without an Origin header (native mobile apps, server-to-server, cURL) are permitted
      if (!origin) {
        return callback(null, true);
      }
      if (permittedOrigins.has(origin)) {
        return callback(null, true);
      }
      // Allow localhost dev servers in non-production environments
      if (!isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      logger.warn(`CORS blocked browser request from unauthorized origin: ${origin}`);
      return callback(new Error(`Origin ${origin} is not permitted by CORS policy`), false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global standard exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global logging interceptor with strict PII & credential redaction
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Global validation pipe for strict DTO payload checking
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // OpenAPI / Swagger UI (enabled outside strict prod unless explicitly requested)
  if (!isProduction || process.env.ENABLE_SWAGGER === 'true') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Affordz API')
      .setDescription('Affordz Unified Order Management, Marketplace & Fulfillment API')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`Affordz Backend REST API running on http://localhost:${port}`);
  logger.log(`Swagger docs available at http://localhost:${port}/api/docs`);
}
bootstrap();
