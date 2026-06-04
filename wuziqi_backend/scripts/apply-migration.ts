import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as postgres from 'postgres';

const pg =
  (postgres as unknown as { default: typeof import('postgres') }).default ??
  (postgres as unknown as typeof import('postgres'));

/**
 * Apply the hand-written wuziqi migration against the SHARED database.
 *
 * We deliberately do NOT use `drizzle-kit push` here: pushing the full schema
 * would try to manage the shared `users`/`allowed_emails` tables. This script
 * runs only drizzle/0000_wuziqi_init.sql, which creates only the wuziqi_*
 * tables with IF NOT EXISTS. (SPEC_WUZIQI §3.)
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const file = path.join(__dirname, '..', 'drizzle', '0000_wuziqi_init.sql');
  const sqlText = fs.readFileSync(file, 'utf8');

  const client = pg(url, { max: 1 });
  console.log(`Applying ${path.basename(file)} ...`);
  await client.unsafe(sqlText);

  const tables = await client`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'wuziqi%'
    ORDER BY table_name`;
  console.log(
    'wuziqi_* tables now present:',
    tables.map((t) => t.table_name).join(', ') || '(none)',
  );

  await client.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
