import 'dotenv/config';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { allowedEmails } from '../src/db/schema';

const pg = (postgres as unknown as { default: typeof import('postgres') }).default ?? postgres;

const EMAILS: { email: string; note?: string }[] = [
  { email: 'tongchenyang62@hotmail.com' },
  { email: 'ziyilai96@gmail.com' },
  { email: 'cheehong0211@hotmail.com' },
  { email: 'jjen09031996@hotmail.com' },
  { email: 'yewshaocong@gmail.com' },
  { email: 'krimson8@gmail.com', note: 'owner' },
  { email: 'krimson8+1@gmail.com', note: 'test alias 1' },
  { email: 'krimson8+2@gmail.com', note: 'test alias 2' },
  { email: 'krimson8+3@gmail.com', note: 'test alias 3' },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const client = pg(url, { max: 1 });
  const db = drizzle(client);

  console.log(`Seeding ${EMAILS.length} allowed emails...`);

  for (const { email, note } of EMAILS) {
    await db
      .insert(allowedEmails)
      .values({ email, note })
      .onConflictDoNothing();
    console.log(`  + ${email}${note ? ` (${note})` : ''}`);
  }

  const rows = await db.execute(sql`SELECT email, note FROM allowed_emails ORDER BY added_at`);
  console.log('\nCurrent allowlist:');
  for (const row of rows) console.log(`  - ${row.email}${row.note ? ` (${row.note})` : ''}`);

  await client.end();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
