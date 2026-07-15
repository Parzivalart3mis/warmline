/**
 * Deletes all data belonging to the demo seed operator (user_seed_operator),
 * leaving every real user untouched. Run this once against production before
 * pointing the drip at real contacts, so the daily cron never emails the
 * demo rows.
 *
 *   pnpm tsx scripts/wipe-seed.ts
 */
import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });
config();

const SEED_USER_ID = process.env.SEED_CLERK_USER_ID ?? 'user_seed_operator';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith('postgres')) {
    console.error('wipe-seed: set DATABASE_URL to the Neon connection string first.');
    process.exit(1);
  }
  const sql = neon(url);

  const [before] = await sql`select count(*)::int n from contacts where user_id = ${SEED_USER_ID}`;
  if ((before?.n ?? 0) === 0) {
    const users = await sql`select 1 from users where clerk_user_id = ${SEED_USER_ID}`;
    if (users.length === 0) {
      console.log(`wipe-seed: no seed user (${SEED_USER_ID}) found — nothing to do.`);
      return;
    }
  }

  // Children first (FKs to users are not ON DELETE CASCADE).
  await sql`delete from events where user_id = ${SEED_USER_ID}`;
  await sql`delete from messages where user_id = ${SEED_USER_ID}`;
  await sql`delete from runs where user_id = ${SEED_USER_ID}`;
  await sql`delete from suppressions where user_id = ${SEED_USER_ID}`;
  await sql`delete from contacts where user_id = ${SEED_USER_ID}`;
  await sql`update users set default_resume_id = null where clerk_user_id = ${SEED_USER_ID}`;
  await sql`delete from resumes where user_id = ${SEED_USER_ID}`;
  await sql`delete from users where clerk_user_id = ${SEED_USER_ID}`;

  console.log(`wipe-seed: removed the seed operator (${SEED_USER_ID}) and all its rows.`);
}

main().catch((err) => {
  console.error('wipe-seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
