import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from '@/db/schema';

/**
 * One query surface, two drivers:
 *  - DATABASE_URL set → Neon serverless HTTP driver (prod/preview).
 *  - No DATABASE_URL  → embedded PGlite persisted in .pglite/ (local dev).
 *
 * Lazy so `next build` never needs a database.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const g = globalThis as unknown as { __warmlineDb?: Promise<Db> };

async function createDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith('postgres')) {
    const { drizzle } = await import('drizzle-orm/neon-http');
    return drizzle(url, { schema, casing: 'snake_case' }) as unknown as Db;
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite('.pglite', { extensions: { citext } });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: './drizzle' });
  return db as unknown as Db;
}

export function getDb(): Promise<Db> {
  g.__warmlineDb ??= createDb();
  return g.__warmlineDb;
}
