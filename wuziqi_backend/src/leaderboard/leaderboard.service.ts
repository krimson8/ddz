import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { DB, Db } from '../db/db.module';
import { wuziqiPlayers, wuziqiResults, users } from '../db/schema';
import type { Move, StoneColor, WinReason, WinnerColor } from '../game/types';

export interface GamePlayerInput {
  uid: string;
  color: StoneColor;
  won: boolean;
}

/** Keep full move history for the newest N games; older games have moves = []. */
const MOVES_RETENTION = 200;

export interface LeaderboardEntry {
  uid: string;
  nickname: string;
  avatarUrl: string | null;
  games: number;
  wins: number;
  blackWins: number;
  whiteWins: number;
  winRate: number; // 0..1
}

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Persist one finished 五子棋 game's result + the two per-player rows.
   * Best-effort: catches and logs errors instead of throwing, so a DB hiccup
   * never breaks the live game flow.
   */
  async recordResult(
    winnerColor: WinnerColor,
    winReason: WinReason,
    players: GamePlayerInput[],
    moves: Move[] = [],
    boardSize = 15,
  ): Promise<void> {
    if (players.length !== 2) {
      this.logger.warn(
        `recordResult: expected 2 players, got ${players.length}`,
      );
      return;
    }

    try {
      await this.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(wuziqiResults)
          .values({ winnerColor, winReason, boardSize, moves })
          .returning({ id: wuziqiResults.id });

        await tx.insert(wuziqiPlayers).values(
          players.map((p) => ({
            gameId: inserted.id,
            uid: p.uid,
            color: p.color,
            won: p.won,
          })),
        );

        // Prune: clear moves from any game outside the newest MOVES_RETENTION.
        const cutoff = await tx
          .select({ id: wuziqiResults.id })
          .from(wuziqiResults)
          .orderBy(desc(wuziqiResults.id))
          .limit(1)
          .offset(MOVES_RETENTION - 1);

        if (cutoff.length > 0) {
          await tx
            .update(wuziqiResults)
            .set({ moves: [] })
            .where(
              and(
                lt(wuziqiResults.id, cutoff[0].id),
                sql`jsonb_array_length(${wuziqiResults.moves}) > 0`,
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
   * `before` is a keyset cursor: the gameId from the previous page's last row.
   */
  async getUserGames(uid: string, limit = 20, before?: number) {
    const rows = await this.db.execute<{
      game_id: number;
      played_at: string;
      winner_color: string;
      win_reason: string;
      has_moves: boolean;
      my_color: string;
      my_won: boolean;
      players: Array<{
        uid: string;
        nickname: string;
        avatar_url: string | null;
        color: string;
        won: boolean;
      }>;
    }>(sql`
      WITH my_games AS (
        SELECT
          gr.id           AS game_id,
          gr.played_at,
          gr.winner_color,
          gr.win_reason,
          jsonb_array_length(gr.moves) > 0 AS has_moves,
          gp_me.color     AS my_color,
          gp_me.won       AS my_won
        FROM ${wuziqiResults} gr
        JOIN ${wuziqiPlayers} gp_me
          ON gp_me.game_id = gr.id AND gp_me.uid = ${uid}
        WHERE ${before === undefined ? sql`TRUE` : sql`gr.id < ${before}`}
        ORDER BY gr.id DESC
        LIMIT ${limit}
      )
      SELECT
        mg.game_id,
        mg.played_at,
        mg.winner_color,
        mg.win_reason,
        mg.has_moves,
        mg.my_color,
        mg.my_won,
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'uid', u.uid,
              'nickname', u.nickname,
              'avatar_url', u.avatar_url,
              'color', gp.color,
              'won', gp.won
            )
            ORDER BY gp.color
          )
          FROM ${wuziqiPlayers} gp
          JOIN ${users} u ON u.uid = gp.uid
          WHERE gp.game_id = mg.game_id
        ) AS players
      FROM my_games mg
      ORDER BY mg.game_id DESC
    `);

    return rows.map((r) => ({
      gameId: Number(r.game_id),
      playedAt: r.played_at,
      winnerColor: r.winner_color as WinnerColor,
      winReason: r.win_reason as WinReason,
      hasMoves: r.has_moves,
      myColor: r.my_color as StoneColor,
      myWon: r.my_won,
      players: (r.players ?? []).map((p) => ({
        uid: p.uid,
        nickname: p.nickname,
        avatarUrl: p.avatar_url,
        color: p.color as StoneColor,
        won: p.won,
      })),
    }));
  }

  /**
   * Full game detail with the stored moves array. Returns null if the game
   * doesn't exist. Moves may be empty if the game was outside the retention window.
   */
  async getGameDetail(gameId: number) {
    const games = await this.db
      .select()
      .from(wuziqiResults)
      .where(eq(wuziqiResults.id, gameId))
      .limit(1);
    if (games.length === 0) return null;
    const game = games[0];

    const playerRows = await this.db.execute<{
      uid: string;
      nickname: string;
      avatar_url: string | null;
      color: string;
      won: boolean;
    }>(sql`
      SELECT u.uid, u.nickname, u.avatar_url, gp.color, gp.won
      FROM ${wuziqiPlayers} gp
      JOIN ${users} u ON u.uid = gp.uid
      WHERE gp.game_id = ${gameId}
      ORDER BY gp.color ASC
    `);

    return {
      gameId: game.id,
      playedAt: game.playedAt,
      winnerColor: game.winnerColor as WinnerColor,
      winReason: game.winReason as WinReason,
      boardSize: game.boardSize,
      moves: (game.moves as Move[]) ?? [],
      players: playerRows.map((p) => ({
        uid: p.uid,
        nickname: p.nickname,
        avatarUrl: p.avatar_url,
        color: p.color as StoneColor,
        won: p.won,
      })),
    };
  }

  /**
   * Global leaderboard ranked by wins desc.
   * Only includes users who have played at least one game.
   */
  async getGlobalLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
    const rows = await this.db.execute<{
      uid: string;
      nickname: string;
      avatar_url: string | null;
      games: string;
      wins: string;
      black_wins: string;
      white_wins: string;
    }>(sql`
      SELECT
        u.uid,
        u.nickname,
        u.avatar_url,
        COUNT(*)                                              AS games,
        COUNT(*) FILTER (WHERE gp.won)                        AS wins,
        COUNT(*) FILTER (WHERE gp.won AND gp.color='black')   AS black_wins,
        COUNT(*) FILTER (WHERE gp.won AND gp.color='white')   AS white_wins
      FROM ${wuziqiPlayers} gp
      JOIN ${users} u USING (uid)
      GROUP BY u.uid, u.nickname, u.avatar_url
      ORDER BY wins DESC, games DESC
      LIMIT ${limit}
    `);

    return rows.map((r) => {
      const games = Number(r.games);
      const wins = Number(r.wins);
      return {
        uid: r.uid,
        nickname: r.nickname,
        avatarUrl: r.avatar_url,
        games,
        wins,
        blackWins: Number(r.black_wins),
        whiteWins: Number(r.white_wins),
        winRate: games > 0 ? wins / games : 0,
      };
    });
  }

  /** Single-user stats, used by the profile page. */
  async getUserStats(uid: string): Promise<LeaderboardEntry | null> {
    const rows = await this.db.execute<{
      uid: string;
      nickname: string;
      avatar_url: string | null;
      games: string;
      wins: string;
      black_wins: string;
      white_wins: string;
    }>(sql`
      SELECT
        u.uid,
        u.nickname,
        u.avatar_url,
        COUNT(gp.uid)                                            AS games,
        COUNT(gp.uid) FILTER (WHERE gp.won)                      AS wins,
        COUNT(gp.uid) FILTER (WHERE gp.won AND gp.color='black') AS black_wins,
        COUNT(gp.uid) FILTER (WHERE gp.won AND gp.color='white') AS white_wins
      FROM ${users} u
      LEFT JOIN ${wuziqiPlayers} gp ON gp.uid = u.uid
      WHERE u.uid = ${uid}
      GROUP BY u.uid, u.nickname, u.avatar_url
    `);

    if (rows.length === 0) return null;
    const r = rows[0];
    const games = Number(r.games);
    const wins = Number(r.wins);
    return {
      uid: r.uid,
      nickname: r.nickname,
      avatarUrl: r.avatar_url,
      games,
      wins,
      blackWins: Number(r.black_wins),
      whiteWins: Number(r.white_wins),
      winRate: games > 0 ? wins / games : 0,
    };
  }
}
