import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED TABLES — owned by the DDZ backend (backend/src/db/schema.ts).
// Declared here ONLY so Drizzle can type queries/joins against them. The wuziqi
// backend MUST NOT db:push these (see drizzle.config.ts tablesFilter + the
// migration discipline in SPEC_WUZIQI §3). Never drop/alter users or
// allowed_emails — they hold the shared identity + invite allowlist.
// ─────────────────────────────────────────────────────────────────────────────

export const allowedEmails = pgTable('allowed_emails', {
  email: text('email').primaryKey(),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  note: text('note'),
});

export const users = pgTable('users', {
  uid: text('uid').primaryKey(),
  email: text('email').notNull().unique(),
  nickname: text('nickname').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW 五子棋 TABLES — owned by this backend. These are the only two tables
// db:push from this app may create. (SPEC_WUZIQI §3)
// ─────────────────────────────────────────────────────────────────────────────

/** One row per finished 五子棋 game. */
export const wuziqiResults = pgTable(
  'wuziqi_results',
  {
    id: serial('id').primaryKey(),
    playedAt: timestamp('played_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** 'black' | 'white' | 'draw' */
    winnerColor: text('winner_color').notNull(),
    /** 'five' | 'timeout' | 'resign' | 'disconnect' | 'draw' */
    winReason: text('win_reason').notNull(),
    boardSize: integer('board_size').notNull().default(15),
    /** Full move history for replay: [{ color, x, y }]. Pruned to [] for old games. */
    moves: jsonb('moves').notNull().default([]),
  },
  (table) => [index('idx_wuziqi_results_id_desc').on(table.id.desc())],
);

/** Two rows per game (one per player). Mirrors DDZ's game_players. */
export const wuziqiPlayers = pgTable(
  'wuziqi_players',
  {
    gameId: integer('game_id').references(() => wuziqiResults.id, {
      onDelete: 'cascade',
    }),
    uid: text('uid').references(() => users.uid),
    /** 'black' | 'white' */
    color: text('color').notNull(),
    won: boolean('won').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.uid] }),
    index('idx_wuziqi_players_uid').on(table.uid),
  ],
);

export type AllowedEmail = typeof allowedEmails.$inferSelect;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type WuziqiResult = typeof wuziqiResults.$inferSelect;
export type WuziqiPlayer = typeof wuziqiPlayers.$inferSelect;
