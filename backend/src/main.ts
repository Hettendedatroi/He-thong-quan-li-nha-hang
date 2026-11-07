import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Số proxy đứng trước API (Cloudflare Tunnel, nginx...): lấy đúng IP khách từ X-Forwarded-For để hạn mức tính theo từng người.
  // Không dùng `true`: khách tự gửi X-Forwarded-For giả là lách được giới hạn số lần đăng nhập sai
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

  app.setGlobalPrefix('api');
  const origins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins?.length ? origins : true, credentials: true });
  // contentSecurityPolicy tắt để Swagger UI chạy được; đây là API server, không render HTML
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: validationExceptionFactory,
    }),
  );

  const uploadDir = join(process.cwd(), 'uploads');
  mkdirSync(uploadDir, { recursive: true });
  app.useStaticAssets(uploadDir, { prefix: '/uploads/' });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Restaurant Management API')
    .setDescription(
      'API cho Hệ thống Quản lý Nhà hàng (Group 4). Realtime qua Socket.IO tại cùng host (xem README).',
    )
    .setVersion('1.0.0')
    // Đưa nhóm Auth lên đầu trang Swagger: đăng nhập lấy accessToken -> bấm "Authorize"
    .addTag('Auth', 'Đăng nhập / đăng ký. Gọi POST /api/auth/login, copy accessToken rồi bấm nút Authorize')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig), {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API: http://localhost:${port}/api  |  Swagger: http://localhost:${port}/docs`, 'Bootstrap');
}

void bootstrap();
