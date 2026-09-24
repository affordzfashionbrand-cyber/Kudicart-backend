import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('KudiCartBackend');
  const app = await NestFactory.create(AppModule);

  // Enable CORS for all clients (Customer RN, Driver RN, Admin/Vendor Web)
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global standard exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

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
  logger.log(`KudiCart Backend REST API running on http://localhost:${port}`);
  logger.log(`Customer & Driver App APIs initialized with strict validation & RBAC`);
}
bootstrap();
