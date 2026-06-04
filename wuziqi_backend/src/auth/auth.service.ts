import { Inject, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../db/db.module';
import { allowedEmails, users } from '../db/schema';
import { admin, initFirebaseAdmin } from './firebase-admin';

export interface AuthedUser {
  uid: string;
  email: string;
  nickname: string;
  avatarUrl: string | null;
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Db) {}

  onModuleInit(): void {
    initFirebaseAdmin();
  }

  /** Verify a Firebase ID token. Throws UnauthorizedException on failure. */
  async verifyToken(idToken: string): Promise<{ uid: string; email: string }> {
    if (!idToken) throw new UnauthorizedException('Missing ID token');
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      if (!decoded.email) throw new UnauthorizedException('Token has no email');
      return { uid: decoded.uid, email: decoded.email.toLowerCase() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid token';
      throw new UnauthorizedException(`Token verification failed: ${msg}`);
    }
  }

  /** Reject if email is not in the allowlist. */
  async assertAllowed(email: string): Promise<void> {
    const rows = await this.db
      .select({ email: allowedEmails.email })
      .from(allowedEmails)
      .where(eq(allowedEmails.email, email))
      .limit(1);
    if (rows.length === 0) {
      throw new UnauthorizedException(`Email ${email} is not on the allowlist`);
    }
  }

  /**
   * Insert the user on first login (nickname = email local-part), no-op afterward.
   * Returns the canonical user record from DB.
   */
  async upsertUser(uid: string, email: string): Promise<AuthedUser> {
    const defaultNickname = email.split('@')[0].slice(0, 20);

    await this.db
      .insert(users)
      .values({ uid, email, nickname: defaultNickname })
      .onConflictDoNothing({ target: users.uid });

    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1);

    if (rows.length === 0) {
      throw new UnauthorizedException('Failed to load user record after upsert');
    }
    const u = rows[0];
    return {
      uid: u.uid,
      email: u.email,
      nickname: u.nickname,
      avatarUrl: u.avatarUrl,
    };
  }

  /**
   * Full auth pipeline: verify token, check allowlist, upsert user.
   * Used by guards.
   */
  async authenticate(idToken: string): Promise<AuthedUser> {
    const { uid, email } = await this.verifyToken(idToken);
    await this.assertAllowed(email);
    return this.upsertUser(uid, email);
  }
}
