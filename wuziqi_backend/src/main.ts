import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Defaults differ from the DDZ backend (port 4896, CORS localhost:3000) so both
// stacks can run side by side locally. Override via PORT / CORS_ORIGIN in prod.
//
// The unified DDZ frontend (origin :3000 in dev, the DDZ domain in prod) now
// opens a socket to THIS backend for the cross-game lobby, so we accept a
// comma-separated list of origins. Default allows the unified FE (:3000) and
// the legacy standalone wuziqi FE (:3001) during the transition.
function corsOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? 'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 4897);
}
bootstrap();
