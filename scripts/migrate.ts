/**
 * Applies Drizzle migrations to a remote Postgres (Neon) using the HTTP
 * driver. Runs as the Vercel build step — this works with a POOLED Neon
 * connection string, where `drizzle-kit migrate`'s CLI does not.
 *
 *   pnpm db:migrate:deploy
 */
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

config({ path: '.env.local' });
config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith('postgres')) {
    console.log('migrate: no DATABASE_URL — skipping (embedded PGlite migrates itself).');
    return;
  }
  const db = drizzle(url);
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('migrate: migrations applied.');
}

main().catch((err) => {
  console.error('migrate failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
