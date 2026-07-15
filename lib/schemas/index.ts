import { z } from 'zod';

/**
 * One source of truth: imported by route handlers AND client forms.
 * Every boundary schema is strict — unknown keys are rejected.
 */

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email must be 254 characters or fewer.')
  .pipe(z.email('That does not look like an email address.'));

const httpsUrl = z.preprocess(
  emptyToUndefined,
  z
    .url({ protocol: /^https$/, error: 'Must be an https URL.' })
    .max(2048, 'URL must be 2048 characters or fewer.')
    .optional(),
);

const optionalTrimmed = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

export const contactCreateSchema = z.strictObject({
  email: emailField,
  firstName: z.string().trim().min(1, 'First name is required.').max(100),
  lastName: z.string().trim().max(100).default(''),
  company: z.string().trim().max(200).default(''),
  contactRole: z.string().trim().max(120).default(''),
  targetRole: z.string().trim().max(120).default(''),
  jobUrl: httpsUrl,
  hook: optionalTrimmed(500),
  linkedinUrl: httpsUrl,
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  resumeId: z.preprocess(emptyToUndefined, z.string().max(64).optional()),
  researchOptIn: z.boolean().default(true),
  source: z.enum(['manual', 'csv', 'paste']).default('manual'),
});

export const contactUpdateSchema = z
  .strictObject({
    email: emailField.optional(),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    company: z.string().trim().max(200).optional(),
    contactRole: z.string().trim().max(120).optional(),
    targetRole: z.string().trim().max(120).optional(),
    jobUrl: httpsUrl,
    hook: optionalTrimmed(500),
    linkedinUrl: httpsUrl,
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    resumeId: z.preprocess(emptyToUndefined, z.string().max(64).optional()),
    researchOptIn: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.');

export const importSchema = z.strictObject({
  rows: z
    .array(contactCreateSchema)
    .min(1, 'No rows to import.')
    .max(500, 'Import 500 rows at a time or fewer.'),
});

export const suppressSchema = z.strictObject({
  reason: optionalTrimmed(500),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM.');

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const settingsUpdateSchema = z
  .strictObject({
    timezone: z.string().max(64).refine(isValidTimeZone, 'Not a valid IANA timezone.').optional(),
    sendTime: hhmm.optional(),
    windowStart: hhmm.optional(),
    windowEnd: hhmm.optional(),
    weekdaysOnly: z.boolean().optional(),
    dailyCap: z.int().min(1).max(100).optional(),
    intervalSeconds: z.int().min(30).max(3600).optional(),
    jitterSeconds: z.int().min(0).max(600).optional(),
    followupDays: z.int().min(1).max(30).optional(),
    maxFollowups: z.int().min(0).max(5).optional(),
    tone: z.string().trim().min(1).max(200).optional(),
    defaultResumeId: z.preprocess(emptyToUndefined, z.string().max(64).optional()),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update.')
  .refine(
    (v) => !(v.windowStart && v.windowEnd) || v.windowStart < v.windowEnd,
    'The window must start before it ends.',
  )
  .refine(
    (v) =>
      v.jitterSeconds === undefined ||
      v.intervalSeconds === undefined ||
      v.jitterSeconds < v.intervalSeconds,
    'Jitter must be smaller than the interval.',
  );

export const messagePatchSchema = z
  .strictObject({
    subject: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(10_000).optional(),
  })
  .refine((v) => v.subject !== undefined || v.body !== undefined, 'Nothing to update.');

export const generateSchema = z.strictObject({
  contactId: z.string().min(1).max(64),
  step: z.int().min(1).max(6).optional(),
});

export const runCreateSchema = z.strictObject({
  kind: z.literal('manual'),
  contactIds: z.array(z.string().min(1).max(64)).min(1).max(100).optional(),
});

export const contactListQuerySchema = z.strictObject({
  status: z.enum(['not_sent', 'queued', 'sent', 'replied', 'failed', 'suppressed']).optional(),
  q: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  cursor: z.preprocess(emptyToUndefined, z.string().max(128).optional()),
});

export const messageListQuerySchema = z.strictObject({
  status: z
    .enum(['draft', 'needs_review', 'queued', 'sending', 'sent', 'failed', 'cancelled'])
    .optional(),
  runId: z.preprocess(emptyToUndefined, z.string().max(64).optional()),
});

export type ContactCreate = z.infer<typeof contactCreateSchema>;
export type ContactUpdate = z.infer<typeof contactUpdateSchema>;
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
export type MessagePatch = z.infer<typeof messagePatchSchema>;
