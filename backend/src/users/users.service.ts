import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../db/db.module';
import { users } from '../db/schema';
import type { AuthedUser } from '../auth/auth.service';
import { GameService } from '../game/game.service';

const NICKNAME_MIN = 2;
const NICKNAME_MAX = 20;

function sanitizeNickname(raw: string): string | null {
  const cleaned = raw
    .replace(/<[^>]*>/g, '') // strip HTML tags
    .replace(/[\x00-\x1f\x7f]/g, '') // strip control chars
    .trim();
  if (cleaned.length < NICKNAME_MIN || cleaned.length > NICKNAME_MAX) return null;
  return cleaned;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly gameService: GameService,
  ) {}

  async updateNickname(uid: string, rawNickname: string): Promise<AuthedUser> {
    const nickname = sanitizeNickname(rawNickname);
    if (!nickname) {
      throw new BadRequestException(
        `Nickname must be ${NICKNAME_MIN}-${NICKNAME_MAX} characters`,
      );
    }

    const updated = await this.db
      .update(users)
      .set({ nickname })
      .where(eq(users.uid, uid))
      .returning();

    if (updated.length === 0) {
      throw new NotFoundException('User not found');
    }

    const u = updated[0];

    // Propagate to live socket sessions + any room the user is in.
    this.gameService.refreshUserInRoom(uid, { nickname: u.nickname });

    return {
      uid: u.uid,
      email: u.email,
      nickname: u.nickname,
      avatarUrl: u.avatarUrl,
    };
  }
}
