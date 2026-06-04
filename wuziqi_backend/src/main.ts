import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Defaults differ from the DDZ backend (port 4896, CORS localhost:3000) so both
// stacks can run side by side locally. Override via PORT / CORS_ORIGIN in prod.
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 4897);
}
bootstrap();
