import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { HttpAuthGuard, AuthedRequest } from '../auth/http-auth.guard';
import { UsersService } from './users.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';

interface UpdateMeBody {
  nickname?: unknown;
}

@Controller('users')
@UseGuards(HttpAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  @Patch('me')
  async updateMe(@Req() req: AuthedRequest, @Body() body: UpdateMeBody) {
    if (typeof body?.nickname !== 'string') {
      throw new BadRequestException('nickname (string) required');
    }
    const updated = await this.usersService.updateNickname(
      req.user.uid,
      body.nickname,
    );
    return updated;
  }

  @Get('me/stats')
  async myStats(@Req() req: AuthedRequest) {
    const stats = await this.leaderboardService.getUserStats(req.user.uid);
    return stats;
  }
}
