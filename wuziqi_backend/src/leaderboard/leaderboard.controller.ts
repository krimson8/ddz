import { Controller, Get, Query } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  /** Public — no auth required. */
  @Get()
  async getGlobal(@Query('limit') limit?: string) {
    const n = limit
      ? Math.max(1, Math.min(200, parseInt(limit, 10) || 50))
      : 50;
    const entries = await this.leaderboardService.getGlobalLeaderboard(n);
    return { entries };
  }
}
