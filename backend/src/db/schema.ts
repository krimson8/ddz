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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const gameResults = pgTable(
  'game_results',
  {
    id: serial('id').primaryKey(),
    playedAt: timestamp('played_at', { withTimezone: true }).defaultNow().notNull(),
    winnerRole: text('winner_role').notNull(),
    plays: jsonb('plays').notNull().default([]),
  },
  (table) => [index('idx_game_results_id_desc').on(table.id.desc())],
);

export const gamePlayers = pgTable(
  'game_players',
  {
    gameId: integer('game_id')
      .notNull()
      .references(() => gameResults.id, { onDelete: 'cascade' }),
    uid: text('uid')
      .notNull()
      .references(() => users.uid),
    role: text('role').notNull(),
    won: boolean('won').notNull(),
    seat: integer('seat').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.uid] }),
    index('idx_game_players_uid').on(table.uid),
  ],
);

export type AllowedEmail = typeof allowedEmails.$inferSelect;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type GameResult = typeof gameResults.$inferSelect;
export type GamePlayer = typeof gamePlayers.$inferSelect;
