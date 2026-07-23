import {
  pgTable,
  pgEnum,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  time,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

/** Case-insensitive email columns (CREATE EXTENSION citext in migration 0000). */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export type ResearchFact = { claim: string; sourceUrl: string };
export type GateIssue = {
  span: string;
  reason: 'unsupported_about_me' | 'unsupported_about_them' | 'fabricated_source';
};

export const contactStatusEnum = pgEnum('contact_status', [
  'not_sent',
  'queued',
  'sent',
  'replied',
  'failed',
  'suppressed',
]);

export const messageStatusEnum = pgEnum('message_status', [
  'draft',
  'needs_review',
  'queued',
  'sending',
  'sent',
  'failed',
  'cancelled',
]);

export const checkStatusEnum = pgEnum('check_status', ['pending', 'pass', 'flag', 'error']);
export const runKindEnum = pgEnum('run_kind', ['daily', 'manual']);
export const runStatusEnum = pgEnum('run_status', [
  'planning',
  'waiting',
  'sending',
  'done',
  'cancelled',
  'failed',
]);
export const eventTypeEnum = pgEnum('event_type', [
  'queued',
  'generated',
  'gate_passed',
  'gate_flagged',
  'sending',
  'sent',
  'failed',
  'replied',
  'suppressed',
  'cancelled',
]);

export const users = pgTable('users', {
  clerkUserId: text().primaryKey(),
  email: text().notNull(),
  timezone: text().notNull().default('America/Chicago'),
  sendTime: time().notNull().default('09:00'),
  windowStart: time().notNull().default('08:00'),
  windowEnd: time().notNull().default('18:00'),
  weekdaysOnly: boolean().notNull().default(true),
  dailyCap: integer().notNull().default(30),
  intervalSeconds: integer().notNull().default(120),
  jitterSeconds: integer().notNull().default(30),
  followupDays: integer().notNull().default(5),
  maxFollowups: integer().notNull().default(2),
  tone: text().notNull().default('warm-direct'),
  defaultResumeId: text(),
  /** Let AI pick the resume version when a contact has no explicit choice. */
  autoSelectResume: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const resumes = pgTable(
  'resumes',
  {
    id: text().primaryKey().$defaultFn(createId),
    userId: text()
      .notNull()
      .references(() => users.clerkUserId),
    label: text().notNull(),
    fileName: text().notNull(),
    blobUrl: text().notNull(),
    extractedText: text().notNull().default(''),
    isDefault: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Exactly one default resume per user.
    uniqueIndex('resumes_one_default_per_user')
      .on(t.userId)
      .where(sql`is_default`),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: text().primaryKey().$defaultFn(createId),
    userId: text()
      .notNull()
      .references(() => users.clerkUserId),
    email: citext().notNull(),
    firstName: text().notNull(),
    lastName: text().notNull().default(''),
    company: text().notNull().default(''),
    contactRole: text().notNull().default(''),
    targetRole: text().notNull().default(''),
    jobUrl: text(),
    hook: text(),
    linkedinUrl: text(),
    tags: jsonb().$type<string[]>().notNull().default([]),
    source: text().notNull().default('manual'),
    resumeId: text().references(() => resumes.id, { onDelete: 'set null' }),
    research: jsonb().$type<ResearchFact[]>(),
    researchedAt: timestamp({ withTimezone: true }),
    researchOptIn: boolean().notNull().default(true),
    status: contactStatusEnum().notNull().default('not_sent'),
    repliedAt: timestamp({ withTimezone: true }),
    suppressed: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('contacts_user_email_unique').on(t.userId, t.email),
    index('contacts_user_status_idx').on(t.userId, t.status),
  ],
);

export const runs = pgTable(
  'runs',
  {
    id: text().primaryKey().$defaultFn(createId),
    userId: text()
      .notNull()
      .references(() => users.clerkUserId),
    workflowRunId: text(),
    kind: runKindEnum().notNull(),
    status: runStatusEnum().notNull().default('planning'),
    /** Checked by sendOne before every send. */
    cancelled: boolean().notNull().default(false),
    plannedCount: integer().notNull().default(0),
    sentCount: integer().notNull().default(0),
    failedCount: integer().notNull().default(0),
    heldCount: integer().notNull().default(0),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('runs_user_started_idx').on(t.userId, t.startedAt)],
);

export const messages = pgTable(
  'messages',
  {
    id: text().primaryKey().$defaultFn(createId),
    userId: text()
      .notNull()
      .references(() => users.clerkUserId),
    contactId: text()
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    /** 1 = initial, 2+ = follow-up. */
    step: integer().notNull().default(1),
    runId: text().references(() => runs.id),
    /** The resume this draft was written from — also the one attached at send
     *  time, so the email's claims and its attachment can never diverge. */
    resumeId: text().references(() => resumes.id, { onDelete: 'set null' }),
    /**
     * Context gathered before drafting: the fetched job posting and how the
     * resume was chosen. Persisted rather than passed between workflow steps —
     * durable workflows store every step argument for replay, so handing a few
     * KB between steps grows the run's state until it collapses. Steps take an
     * id and read this instead.
     */
    prepareMeta: jsonb().$type<{
      jobPostingText?: string;
      resumeVia?: string;
      resumeReason?: string;
    }>(),
    status: messageStatusEnum().notNull().default('draft'),
    checkStatus: checkStatusEnum().notNull().default('pending'),
    checkIssues: jsonb().$type<GateIssue[]>(),
    subject: text().notNull().default(''),
    body: text().notNull().default(''),
    model: text().notNull().default(''),
    grounded: boolean().notNull().default(false),
    scheduledFor: timestamp({ withTimezone: true }),
    sentAt: timestamp({ withTimezone: true }),
    /** Our own deterministic Message-ID, set before send. */
    rfcMessageId: text(),
    /** Threading headers so follow-ups land in the same thread. */
    inReplyTo: text(),
    references: text(),
    errorCode: text(),
    errorMessage: text(),
    attempts: integer().notNull().default(0),
    idempotencyKey: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('messages_idempotency_key_unique').on(t.idempotencyKey),
    // One live message per (contact, step) — cancelled rows don't count.
    uniqueIndex('messages_contact_step_unique')
      .on(t.contactId, t.step)
      .where(sql`status <> 'cancelled'`),
    // At most ONE pending send per contact, ever. This prevents double-sends.
    uniqueIndex('messages_one_pending_per_contact')
      .on(t.contactId)
      .where(sql`status IN ('queued', 'sending')`),
    index('messages_user_status_scheduled_idx').on(t.userId, t.status, t.scheduledFor),
    index('messages_run_idx').on(t.runId),
  ],
);

export const events = pgTable(
  'events',
  {
    id: text().primaryKey().$defaultFn(createId),
    userId: text().notNull(),
    contactId: text(),
    messageId: text(),
    type: eventTypeEnum().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('events_user_created_idx').on(t.userId, t.createdAt)],
);

export const suppressions = pgTable(
  'suppressions',
  {
    id: text().primaryKey().$defaultFn(createId),
    userId: text()
      .notNull()
      .references(() => users.clerkUserId),
    email: citext().notNull(),
    reason: text().notNull().default(''),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('suppressions_user_email_unique').on(t.userId, t.email)],
);

export type User = typeof users.$inferSelect;
export type Resume = typeof resumes.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type Suppression = typeof suppressions.$inferSelect;
