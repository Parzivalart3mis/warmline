import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import path from 'node:path';
import * as schema from '@/db/schema';
import type { Db } from '@/lib/db';

/** Fresh in-memory Postgres per test file. No Docker. */
export async function makeTestDb(): Promise<Db> {
  const client = new PGlite({ extensions: { citext } });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  return db as unknown as Db;
}

let seq = 0;
const next = () => (seq += 1);

export async function mkUser(db: Db, overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const n = next();
  const [row] = await db
    .insert(schema.users)
    .values({
      clerkUserId: overrides.clerkUserId ?? `user_${n}`,
      email: overrides.email ?? `operator${n}@gmail.com`,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('mkUser failed');
  return row;
}

export async function mkResume(
  db: Db,
  userId: string,
  overrides: Partial<typeof schema.resumes.$inferInsert> = {},
) {
  const n = next();
  const [row] = await db
    .insert(schema.resumes)
    .values({
      userId,
      label: overrides.label ?? `Resume ${n}`,
      fileName: overrides.fileName ?? `resume-${n}.pdf`,
      blobUrl: overrides.blobUrl ?? `https://blob.example.com/resume-${n}.pdf`,
      extractedText: overrides.extractedText ?? 'Built systems. Shipped software.',
      isDefault: overrides.isDefault ?? false,
    })
    .returning();
  if (!row) throw new Error('mkResume failed');
  return row;
}

export async function mkContact(
  db: Db,
  userId: string,
  overrides: Partial<typeof schema.contacts.$inferInsert> = {},
) {
  const n = next();
  const [row] = await db
    .insert(schema.contacts)
    .values({
      userId,
      email: overrides.email ?? `person${n}@example.com`,
      firstName: overrides.firstName ?? `Person${n}`,
      lastName: overrides.lastName ?? 'Test',
      company: overrides.company ?? `Company ${n}`,
      targetRole: overrides.targetRole ?? 'Backend Engineer',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('mkContact failed');
  return row;
}

export async function mkRun(
  db: Db,
  userId: string,
  overrides: Partial<typeof schema.runs.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.runs)
    .values({ userId, kind: overrides.kind ?? 'manual', ...overrides })
    .returning();
  if (!row) throw new Error('mkRun failed');
  return row;
}

export async function mkMessage(
  db: Db,
  userId: string,
  contactId: string,
  overrides: Partial<typeof schema.messages.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.messages)
    .values({
      userId,
      contactId,
      subject: overrides.subject ?? 'Test subject',
      body: overrides.body ?? 'Test body.',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('mkMessage failed');
  return row;
}
