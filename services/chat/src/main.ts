import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 只放行本地 Web（开发环境）
  app.enableCors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3002' });
  const port = process.env.PORT ?? 4001;
  await app.listen(port);
  console.log(`Chat service running on http://localhost:${port}`);
}
bootstrap();
