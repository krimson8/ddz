import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB, Db } from '../db/db.module';
import { gamePlayers, gameResults, users } from '../db/schema';

export interface GamePlayerInput {
  uid: string;
  role: 'landlord' | 'farmer';
  won: boolean;
  seat: number; // 0/1/2
}

export interface LeaderboardEntry {
  uid: string;
  nickname: string;
  avatarUrl: string | null;
  games: number;
  totalWins: number;
  landlordWins: number;
  farmerWins: number;
  winRate: number; // 0..1
}

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Persist one finished game's result + per-player rows.
   * Best-effort: catches and logs errors instead of throwing, so a DB hiccup
   * never breaks the live game flow.
   */
  async recordResult(
    winnerRole: 'landlord' | 'farmer',
    players: GamePlayerInput[],
  ): Promise<void> {
    if (players.length !== 3) {
      this.logger.warn(`recordResult: expected 3 players, got ${players.length}`);
      return;
    }

    try {
      await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(gameResults)
          .values({ winnerRole })
          .returning({ id: gameResults.id });

        await tx.insert(gamePlayers).values(
          players.map((p) => ({
            gameId: inserted.id,
            uid: p.uid,
            role: p.role,
            won: p.won,
            seat: p.seat,
          })),
        );
      });
    } catch (err) {
      this.logger.error(
        `recordResult failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Global leaderboard ranked by total wins desc.
   * Only includes users who have played at least one game.
   */
  async getGlobalLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
    const rows = await this.db.execute<{
      uid: string;
      nickname: string;
      avatar_url: string | null;
      games: string;
      total_wins: string;
      landlord_wins: string;
      farmer_wins: string;
    }>(sql`
      SELECT
        u.uid,
        u.nickname,
        u.avatar_url,
        COUNT(*)                                            AS games,
        COUNT(*) FILTER (WHERE gp.won)                      AS total_wins,
        COUNT(*) FILTER (WHERE gp.won AND gp.role='landlord') AS landlord_wins,
        COUNT(*) FILTER (WHERE gp.won AND gp.role='farmer')   AS farmer_wins
      FROM ${gamePlayers} gp
      JOIN ${users} u USING (uid)
      GROUP BY u.uid, u.nickname, u.avatar_url
      ORDER BY total_wins DESC, games DESC
      LIMIT ${limit}
    `);

    return rows.map((r) => {
      const games = Number(r.games);
      const totalWins = Number(r.total_wins);
      return {
        uid: r.uid,
        nickname: r.nickname,
        avatarUrl: r.avatar_url,
        games,
        totalWins,
        landlordWins: Number(r.landlord_wins),
        farmerWins: Number(r.farmer_wins),
        winRate: games > 0 ? totalWins / games : 0,
      };
    });
  }

  /** Single-user stats, used by the (future) profile page. */
  async getUserStats(uid: string): Promise<LeaderboardEntry | null> {
    const rows = await this.db.execute<{
      uid: string;
      nickname: string;
      avatar_url: string | null;
      games: string;
      total_wins: string;
      landlord_wins: string;
      farmer_wins: string;
    }>(sql`
      SELECT
        u.uid,
        u.nickname,
        u.avatar_url,
        COUNT(gp.uid)                                       AS games,
        COUNT(gp.uid) FILTER (WHERE gp.won)                 AS total_wins,
        COUNT(gp.uid) FILTER (WHERE gp.won AND gp.role='landlord') AS landlord_wins,
        COUNT(gp.uid) FILTER (WHERE gp.won AND gp.role='farmer')   AS farmer_wins
      FROM ${users} u
      LEFT JOIN ${gamePlayers} gp ON gp.uid = u.uid
      WHERE u.uid = ${uid}
      GROUP BY u.uid, u.nickname, u.avatar_url
    `);

    if (rows.length === 0) return null;
    const r = rows[0];
    const games = Number(r.games);
    const totalWins = Number(r.total_wins);
    return {
      uid: r.uid,
      nickname: r.nickname,
      avatarUrl: r.avatar_url,
      games,
      totalWins,
      landlordWins: Number(r.landlord_wins),
      farmerWins: Number(r.farmer_wins),
      winRate: games > 0 ? totalWins / games : 0,
    };
  }
}

// Keep imports satisfied (eq is referenced from schema in some Drizzle versions)
void eq;
