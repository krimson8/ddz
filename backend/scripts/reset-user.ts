/**
 * Reset a user: delete their Firebase Auth record AND their row in `users`.
 * Use when an account was created with a different password and you want to
 * start fresh (e.g. legacy magic-link signup or wrong password during dev).
 *
 * Usage:
 *   npm run db:reset-user -- email1@example.com email2@example.com
 *
 * After running, the user can sign in normally on the login page and the
 * frontend's signInOrCreate will create them anew with the typed password.
 */
import 'dotenv/config';
import * as postgresNs from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
import { initFirebaseAdmin, admin } from '../src/auth/firebase-admin';

const pg = (postgresNs as unknown as { default: typeof import('postgres') }).default ?? (postgresNs as unknown as typeof import('postgres'));

async function main() {
  const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) {
    console.error('Usage: npm run db:reset-user -- <email> [<email> ...]');
    process.exit(1);
  }

  initFirebaseAdmin();

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const client = pg(url, { max: 1 });
  const db = drizzle(client);

  for (const email of emails) {
    console.log(`\n--- Resetting ${email} ---`);

    // 1. Delete from Firebase Auth
    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      await admin.auth().deleteUser(userRecord.uid);
      console.log(`  ✓ Firebase: deleted uid ${userRecord.uid}`);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/user-not-found') {
        console.log('  ⏭ Firebase: no user found');
      } else {
        console.error('  ✗ Firebase error:', err);
      }
    }

    // 2. Delete from Postgres users table
    try {
      const deleted = await db
        .delete(users)
        .where(eq(users.email, email))
        .returning({ uid: users.uid });
      if (deleted.length > 0) {
        console.log(`  ✓ Postgres: deleted row uid=${deleted[0].uid}`);
      } else {
        console.log('  ⏭ Postgres: no row found');
      }
    } catch (err) {
      console.error('  ✗ Postgres error:', err);
    }
  }

  await client.end();
  console.log('\nDone. Users can now sign in fresh with any password.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
