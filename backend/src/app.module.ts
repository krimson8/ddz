import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GameModule } from './game/game.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [GameModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
