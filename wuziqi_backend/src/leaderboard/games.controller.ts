import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { HttpAuthGuard } from '../auth/http-auth.guard';
import { LeaderboardService } from './leaderboard.service';

@Controller('games')
@UseGuards(HttpAuthGuard)
export class GamesController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get(':id')
  async getGame(@Param('id') idRaw: string) {
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException('invalid game id');
    }
    const game = await this.leaderboardService.getGameDetail(id);
    if (!game) throw new NotFoundException();
    return game;
  }
}
