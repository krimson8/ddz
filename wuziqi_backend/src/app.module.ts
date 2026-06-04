import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GameModule } from './game/game.module';
import { HealthController } from './health/health.controller';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [DbModule, AuthModule, LeaderboardModule, UsersModule, GameModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
