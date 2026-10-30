import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const logger = new Logger('AffordzBackend');
  const app = await NestFactory.create(AppModule);

  // Configure CORS with fail-closed production origin validation
  const isProduction = process.env.APP_ENV === 'production';
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : isProduction
      ? ['https://affordz.com', 'https://admin.affordz.com', 'https://vendor.affordz.com']
      : true;

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global standard exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global logging interceptor with strict PII & credential redaction (Item 8)
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

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`Affordz Backend REST API running on http://localhost:${port}`);
  logger.log(`Customer & Driver App APIs initialized with strict validation, RBAC & logging redaction`);
}
bootstrap();
