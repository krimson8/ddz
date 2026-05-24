import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { HttpAuthGuard, AuthedRequest } from '../auth/http-auth.guard';
import { UsersService } from './users.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';

interface UpdateMeBody {
  nickname?: unknown;
  avatarUrl?: unknown;
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
    const hasNickname = body?.nickname !== undefined;
    const hasAvatar = body?.avatarUrl !== undefined;
    if (!hasNickname && !hasAvatar) {
      throw new BadRequestException('nickname or avatarUrl required');
    }
    if (hasNickname && typeof body.nickname !== 'string') {
      throw new BadRequestException('nickname must be a string');
    }
    if (hasAvatar && body.avatarUrl !== null && typeof body.avatarUrl !== 'string') {
      throw new BadRequestException('avatarUrl must be a string or null');
    }
    const updated = await this.usersService.updateProfile(req.user.uid, {
      nickname: hasNickname ? (body.nickname as string) : undefined,
      avatarUrl: hasAvatar ? (body.avatarUrl as string | null) : undefined,
    });
    return updated;
  }

  @Get('me/stats')
  async myStats(@Req() req: AuthedRequest) {
    const stats = await this.leaderboardService.getUserStats(req.user.uid);
    return stats;
  }

  @Get('me/games')
  async myGames(
    @Req() req: AuthedRequest,
    @Query('limit') limitRaw?: string,
    @Query('before') beforeRaw?: string,
  ) {
    const limit = Math.min(50, Math.max(1, Number(limitRaw) || 20));
    const before = beforeRaw ? Number(beforeRaw) : undefined;
    if (before !== undefined && !Number.isFinite(before)) {
      throw new BadRequestException('before must be a number');
    }
    const games = await this.leaderboardService.getUserGames(
      req.user.uid,
      limit,
      before,
    );
    return { games };
  }
}
