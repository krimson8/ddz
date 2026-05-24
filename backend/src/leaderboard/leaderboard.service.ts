import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { DB, Db } from '../db/db.module';
import { gamePlayers, gameResults, users } from '../db/schema';

export interface GamePlayerInput {
  uid: string;
  role: 'landlord' | 'farmer';
  won: boolean;
  seat: number; // 0/1/2
}

/**
 * Single play row stored inside `game_results.plays` JSONB.
 * `seat` is 0/1/2 and indexes into the `game_players` rows of the same game.
 */
export interface StoredPlay {
  seat: number;
  cards: { suit: string; rank: number }[];
}

/** Keep full plays for the newest N games; older games have plays = []. */
const PLAYS_RETENTION = 200;

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
    plays: StoredPlay[] = [],
  ): Promise<void> {
    if (players.length !== 3) {
      this.logger.warn(`recordResult: expected 3 players, got ${players.length}`);
      return;
    }

    try {
      await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(gameResults)
          .values({ winnerRole, plays })
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

        // Prune: clear plays from any game outside the newest PLAYS_RETENTION.
        // Find the cutoff id (the oldest "kept" game), then null out plays for older ids.
        const cutoff = await tx
          .select({ id: gameResults.id })
          .from(gameResults)
          .orderBy(desc(gameResults.id))
          .limit(1)
          .offset(PLAYS_RETENTION - 1);

        if (cutoff.length > 0) {
          await tx
            .update(gameResults)
            .set({ plays: [] })
            .where(
              and(
                lt(gameResults.id, cutoff[0].id),
                sql`jsonb_array_length(${gameResults.plays}) > 0`,
              ),
            );
        }
      });
    } catch (err) {
      this.logger.error(
        `recordResult failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Per-user history ───────────────────────────────────────────────────────

  /**
   * Paginated list of games a user has played, newest first.
   * Returns lightweight rows for the history list (no plays payload).
   * `before` is a keyset cursor: the gameId from the previous page's last row.
   */
  async getUserGames(uid: string, limit = 20, before?: number) {
    const rows = await this.db.execute<{
      game_id: number;
      played_at: string;
      winner_role: string;
      has_plays: boolean;
      my_role: string;
      my_won: boolean;
      my_seat: number;
      players: Array<{
        uid: string;
        nickname: string;
        avatar_url: string | null;
        role: string;
        won: boolean;
        seat: number;
      }>;
    }>(sql`
      WITH my_games AS (
        SELECT
          gr.id           AS game_id,
          gr.played_at,
          gr.winner_role,
          jsonb_array_length(gr.plays) > 0 AS has_plays,
          gp_me.role      AS my_role,
          gp_me.won       AS my_won,
          gp_me.seat      AS my_seat
        FROM ${gameResults} gr
        JOIN ${gamePlayers} gp_me
          ON gp_me.game_id = gr.id AND gp_me.uid = ${uid}
        WHERE ${before === undefined ? sql`TRUE` : sql`gr.id < ${before}`}
        ORDER BY gr.id DESC
        LIMIT ${limit}
      )
      SELECT
        mg.game_id,
        mg.played_at,
        mg.winner_role,
        mg.has_plays,
        mg.my_role,
        mg.my_won,
        mg.my_seat,
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'uid', u.uid,
              'nickname', u.nickname,
              'avatar_url', u.avatar_url,
              'role', gp.role,
              'won', gp.won,
              'seat', gp.seat
            )
            ORDER BY gp.seat
          )
          FROM ${gamePlayers} gp
          JOIN ${users} u ON u.uid = gp.uid
          WHERE gp.game_id = mg.game_id
        ) AS players
      FROM my_games mg
      ORDER BY mg.game_id DESC
    `);

    return rows.map((r) => ({
      gameId: Number(r.game_id),
      playedAt: r.played_at,
      winnerRole: r.winner_role as 'landlord' | 'farmer',
      hasPlays: r.has_plays,
      myRole: r.my_role as 'landlord' | 'farmer',
      myWon: r.my_won,
      mySeat: Number(r.my_seat),
      players: (r.players ?? []).map((p) => ({
        uid: p.uid,
        nickname: p.nickname,
        avatarUrl: p.avatar_url,
        role: p.role as 'landlord' | 'farmer',
        won: p.won,
        seat: Number(p.seat),
      })),
    }));
  }

  /**
   * Full game detail with the stored plays array. Returns null if the game
   * doesn't exist. Plays may be empty if the game was outside the retention window.
   */
  async getGameDetail(gameId: number) {
    const games = await this.db
      .select()
      .from(gameResults)
      .where(eq(gameResults.id, gameId))
      .limit(1);
    if (games.length === 0) return null;
    const game = games[0];

    const playerRows = await this.db.execute<{
      uid: string;
      nickname: string;
      avatar_url: string | null;
      role: string;
      won: boolean;
      seat: number;
    }>(sql`
      SELECT u.uid, u.nickname, u.avatar_url, gp.role, gp.won, gp.seat
      FROM ${gamePlayers} gp
      JOIN ${users} u ON u.uid = gp.uid
      WHERE gp.game_id = ${gameId}
      ORDER BY gp.seat ASC
    `);

    return {
      gameId: game.id,
      playedAt: game.playedAt,
      winnerRole: game.winnerRole as 'landlord' | 'farmer',
      plays: (game.plays as StoredPlay[]) ?? [],
      players: playerRows.map((p) => ({
        uid: p.uid,
        nickname: p.nickname,
        avatarUrl: p.avatar_url,
        role: p.role as 'landlord' | 'farmer',
        won: p.won,
        seat: Number(p.seat),
      })),
    };
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
