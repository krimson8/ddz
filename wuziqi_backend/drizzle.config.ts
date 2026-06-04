import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to wuziqi_backend/.env');
}

// ⚠️ SHARED DATABASE. This Postgres instance is shared with the DDZ backend.
// `tablesFilter` restricts drizzle-kit (push/pull/diff) to ONLY the wuziqi_*
// tables, so a db:push from this app can never drop or alter the shared
// `users`/`allowed_emails` tables or DDZ's `game_results`/`game_players`.
// ALWAYS inspect the generated statements before applying (SPEC_WUZIQI §3).
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  tablesFilter: ['wuziqi_*'],
  verbose: true,
  strict: true,
});
