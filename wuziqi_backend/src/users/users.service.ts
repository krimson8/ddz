import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../db/db.module';
import { users } from '../db/schema';
import type { AuthedUser } from '../auth/auth.service';
import { GameService } from '../game/game.service';

const NICKNAME_MIN = 2;
const NICKNAME_MAX = 20;
/**
 * Hard cap on the stored avatar string. Avatars are base64-encoded JPEG data
 * URLs produced by client-side resize to 256×256. Writes the SHARED users
 * table, so this cap must match DDZ's (SPEC_WUZIQI §10a).
 */
const AVATAR_MAX_BYTES = 64 * 1024;

function sanitizeNickname(raw: string): string | null {
  const cleaned = raw
    .replace(/<[^>]*>/g, '') // strip HTML tags
    .replace(/[\x00-\x1f\x7f]/g, '') // strip control chars
    .trim();
  if (cleaned.length < NICKNAME_MIN || cleaned.length > NICKNAME_MAX)
    return null;
  return cleaned;
}

function validateAvatarUrl(raw: string | null): string | null {
  if (raw === null) return null;
  if (raw.length > AVATAR_MAX_BYTES) return null;
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(raw))
    return null;
  return raw;
}

export interface ProfilePatch {
  nickname?: string;
  avatarUrl?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly gameService: GameService,
  ) {}

  async updateProfile(uid: string, patch: ProfilePatch): Promise<AuthedUser> {
    const set: { nickname?: string; avatarUrl?: string | null } = {};

    if (patch.nickname !== undefined) {
      const nickname = sanitizeNickname(patch.nickname);
      if (!nickname) {
        throw new BadRequestException(
          `Nickname must be ${NICKNAME_MIN}-${NICKNAME_MAX} characters`,
        );
      }
      set.nickname = nickname;
    }

    if (patch.avatarUrl !== undefined) {
      const avatarUrl = validateAvatarUrl(patch.avatarUrl);
      if (patch.avatarUrl !== null && avatarUrl === null) {
        throw new BadRequestException(
          `avatarUrl must be a base64 image data URL under ${AVATAR_MAX_BYTES} bytes`,
        );
      }
      set.avatarUrl = avatarUrl;
    }

    if (Object.keys(set).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const updated = await this.db
      .update(users)
      .set(set)
      .where(eq(users.uid, uid))
      .returning();

    if (updated.length === 0) {
      throw new NotFoundException('User not found');
    }

    const u = updated[0];

    // Propagate to live socket sessions + any room the user is in (this backend
    // only — a change here reflects in DDZ on the DDZ user's next join; that's
    // expected, see SPEC_WUZIQI §8).
    this.gameService.refreshUserInRoom(uid, {
      ...(set.nickname !== undefined ? { nickname: u.nickname } : {}),
      ...(set.avatarUrl !== undefined ? { avatarUrl: u.avatarUrl } : {}),
    });

    return {
      uid: u.uid,
      email: u.email,
      nickname: u.nickname,
      avatarUrl: u.avatarUrl,
    };
  }
}
