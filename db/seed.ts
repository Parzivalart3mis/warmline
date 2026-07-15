/**
 * Seed: one operator, three resume versions, ~25 contacts across ~15
 * companies with a realistic spread of statuses, an in-flight run, and a
 * plausible event history — a queue board that looks like a real Tuesday.
 * `pnpm db:seed` (uses PGlite locally when DATABASE_URL is unset).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '../lib/db';
import { users, resumes, contacts, runs, messages, events, suppressions } from './schema';

export const SEED_USER_ID = process.env.SEED_CLERK_USER_ID ?? 'user_seed_operator';
const SEED_EMAIL = process.env.GMAIL_USER ?? 'you@gmail.com';

const min = (n: number) => n * 60_000;

const RESUME_TEXT = {
  backend: `Yash Sharma — Backend Engineer
Chicago, IL · ysharma@hawk.illinoistech.edu
Experience: Software Engineering Intern, mid-size fintech (2025) — built a Postgres-backed
reconciliation service in Go handling 2M transactions/day; cut nightly batch time 40%.
Teaching Assistant, Distributed Systems (2024-2025). Projects: StreamVault — Go monetization
API with Stripe webhooks, idempotent payout ledger; Tally — bill-splitting PWA with exact
cents arithmetic. Skills: Go, TypeScript, Postgres, Redis, Kafka, AWS, Terraform.
M.S. Computer Science, Illinois Institute of Technology, 2026.`,
  ml: `Yash Sharma — ML Engineer
Chicago, IL · ysharma@hawk.illinoistech.edu
Experience: Research Assistant, IIT ML Lab (2024-2026) — trained retrieval-augmented
ranking models; improved MRR 12% on internal benchmark. Software Engineering Intern (2025) —
shipped feature store pipelines (Python, Spark). Projects: Inflect — language-learning app
with SM-2 spaced repetition and live speech scoring; MacroMap — nutrition tracker with
trigram dedup. Skills: Python, PyTorch, transformers, pgvector, Airflow, GCP.
M.S. Computer Science (ML specialization), Illinois Institute of Technology, 2026.`,
  fullstack: `Yash Sharma — Full-stack Engineer
Chicago, IL · ysharma@hawk.illinoistech.edu
Experience: Software Engineering Intern (2025) — led migration of a customer dashboard to
Next.js App Router; Core Web Vitals p75 LCP 4.1s → 1.8s. Freelance (2023-2025) — shipped
nine production PWAs for small businesses. Projects: Folio — PDF editor PWA; Reel —
film tracker with offline sync. Skills: TypeScript, React, Next.js, Node, Postgres,
Drizzle, Tailwind, Playwright. M.S. Computer Science, Illinois Institute of Technology, 2026.`,
};

type SeedContact = {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  contactRole: string;
  targetRole: string;
  resume: 'backend' | 'ml' | 'fullstack';
  hook?: string;
  tags?: string[];
};

const PEOPLE: SeedContact[] = [
  {
    email: 'priya.raman@stripe.com',
    firstName: 'Priya',
    lastName: 'Raman',
    company: 'Stripe',
    contactRole: 'Engineering Manager, Payments Infra',
    targetRole: 'Backend Engineer',
    resume: 'backend',
    hook: 'Her QCon talk on idempotency keys',
    tags: ['payments', 'dream'],
  },
  {
    email: 'dmarch@linear.app',
    firstName: 'Daniel',
    lastName: 'March',
    company: 'Linear',
    contactRole: 'Staff Engineer',
    targetRole: 'Full-stack Engineer',
    resume: 'fullstack',
    tags: ['product-eng'],
  },
  {
    email: 'j.okafor@ramp.com',
    firstName: 'Jade',
    lastName: 'Okafor',
    company: 'Ramp',
    contactRole: 'Recruiter, Engineering',
    targetRole: 'Backend Engineer',
    resume: 'backend',
    tags: ['fintech'],
  },
  {
    email: 'swu@vercel.com',
    firstName: 'Selina',
    lastName: 'Wu',
    company: 'Vercel',
    contactRole: 'EM, Compute',
    targetRole: 'Full-stack Engineer',
    resume: 'fullstack',
    hook: 'Fluid compute launch post',
  },
  {
    email: 'tomasz@neon.tech',
    firstName: 'Tomasz',
    lastName: 'Kowalski',
    company: 'Neon',
    contactRole: 'Engineering Lead, Storage',
    targetRole: 'Backend Engineer',
    resume: 'backend',
  },
  {
    email: 'a.beaumont@datadoghq.com',
    firstName: 'Alice',
    lastName: 'Beaumont',
    company: 'Datadog',
    contactRole: 'Senior EM, Metrics',
    targetRole: 'Backend Engineer',
    resume: 'backend',
    tags: ['observability'],
  },
  {
    email: 'kenji.sato@figma.com',
    firstName: 'Kenji',
    lastName: 'Sato',
    company: 'Figma',
    contactRole: 'EM, Multiplayer',
    targetRole: 'Full-stack Engineer',
    resume: 'fullstack',
  },
  {
    email: 'mgold@notion.so',
    firstName: 'Maya',
    lastName: 'Gold',
    company: 'Notion',
    contactRole: 'Recruiter',
    targetRole: 'Full-stack Engineer',
    resume: 'fullstack',
  },
  {
    email: 'r.iyer@retool.com',
    firstName: 'Rohan',
    lastName: 'Iyer',
    company: 'Retool',
    contactRole: 'Head of Engineering',
    targetRole: 'Full-stack Engineer',
    resume: 'fullstack',
  },
  {
    email: 'lena@temporal.io',
    firstName: 'Lena',
    lastName: 'Fischer',
    company: 'Temporal',
    contactRole: 'Staff Engineer, SDK',
    targetRole: 'Backend Engineer',
    resume: 'backend',
    hook: 'Durable execution — same problem Warmline solves',
  },
  {
    email: 'oscar@modal.com',
    firstName: 'Oscar',
    lastName: 'Lindqvist',
    company: 'Modal',
    contactRole: 'Founding Engineer',
    targetRole: 'ML Engineer',
    resume: 'ml',
    tags: ['ml-infra'],
  },
  {
    email: 'nina.park@render.com',
    firstName: 'Nina',
    lastName: 'Park',
    company: 'Render',
    contactRole: 'EM, Platform',
    targetRole: 'Backend Engineer',
    resume: 'backend',
  },
  {
    email: 'gabriel@supabase.com',
    firstName: 'Gabriel',
    lastName: 'Costa',
    company: 'Supabase',
    contactRole: 'Engineering Lead, Auth',
    targetRole: 'Full-stack Engineer',
    resume: 'fullstack',
  },
  {
    email: 'h.tanaka@anthropic.com',
    firstName: 'Hana',
    lastName: 'Tanaka',
    company: 'Anthropic',
    contactRole: 'Recruiter, Research Eng',
    targetRole: 'ML Engineer',
    resume: 'ml',
    tags: ['dream'],
  },
  {
    email: 'wes@planetscale.com',
    firstName: 'Wes',
    lastName: 'Turner',
    company: 'PlanetScale',
    contactRole: 'Senior EM',
    targetRole: 'Backend Engineer',
    resume: 'backend',
  },
  {
    email: 'ivy.chen@airtable.com',
    firstName: 'Ivy',
    lastName: 'Chen',
    company: 'Airtable',
    contactRole: 'EM, Automations',
    targetRole: 'Full-stack Engineer',
    resume: 'fullstack',
  },
  {
    email: 'marco@duckdb.org',
    firstName: 'Marco',
    lastName: 'Rossi',
    company: 'DuckDB Labs',
    contactRole: 'Engineer',
    targetRole: 'Backend Engineer',
    resume: 'backend',
  },
  {
    email: 's.almasi@openai.com',
    firstName: 'Sara',
    lastName: 'Almasi',
    company: 'OpenAI',
    contactRole: 'Recruiter, Applied',
    targetRole: 'ML Engineer',
    resume: 'ml',
  },
  {
    email: 'petra@grafana.com',
    firstName: 'Petra',
    lastName: 'Novak',
    company: 'Grafana Labs',
    contactRole: 'EM, Dashboards',
    targetRole: 'Full-stack Engineer',
    resume: 'fullstack',
  },
  {
    email: 'liam.doyle@cloudflare.com',
    firstName: 'Liam',
    lastName: 'Doyle',
    company: 'Cloudflare',
    contactRole: 'EM, Workers',
    targetRole: 'Backend Engineer',
    resume: 'backend',
  },
  {
    email: 'zoe@huggingface.co',
    firstName: 'Zoe',
    lastName: 'Martin',
    company: 'Hugging Face',
    contactRole: 'ML Engineer',
    targetRole: 'ML Engineer',
    resume: 'ml',
  },
  {
    email: 'arjun.mehta@databricks.com',
    firstName: 'Arjun',
    lastName: 'Mehta',
    company: 'Databricks',
    contactRole: 'Senior EM, Serving',
    targetRole: 'ML Engineer',
    resume: 'ml',
  },
  {
    email: 'freya@fly.io',
    firstName: 'Freya',
    lastName: 'Berg',
    company: 'Fly.io',
    contactRole: 'Platform Engineer',
    targetRole: 'Backend Engineer',
    resume: 'backend',
  },
  {
    email: 'cole@warp.dev',
    firstName: 'Cole',
    lastName: 'Bennett',
    company: 'Warp',
    contactRole: 'Founding Engineer',
    targetRole: 'Full-stack Engineer',
    resume: 'fullstack',
  },
  {
    email: 'amara.diallo@turso.tech',
    firstName: 'Amara',
    lastName: 'Diallo',
    company: 'Turso',
    contactRole: 'DX Engineer',
    targetRole: 'Backend Engineer',
    resume: 'backend',
  },
];

type ContactRow = typeof contacts.$inferSelect;

async function main() {
  const db = await getDb();
  const now = Date.now();

  const existing = await db.select().from(users).where(eq(users.clerkUserId, SEED_USER_ID));
  if (existing.length > 0) {
    console.log(
      `seed: user ${SEED_USER_ID} already exists — delete .pglite/ (or the rows) to reseed`,
    );
    return;
  }

  await db
    .insert(users)
    .values({ clerkUserId: SEED_USER_ID, email: SEED_EMAIL, timezone: 'America/Chicago' });

  const resumeRows = await db
    .insert(resumes)
    .values([
      {
        userId: SEED_USER_ID,
        label: 'Backend',
        fileName: 'yash-backend.pdf',
        blobUrl: 'https://example.blob.vercel-storage.com/yash-backend.pdf',
        extractedText: RESUME_TEXT.backend,
        isDefault: true,
      },
      {
        userId: SEED_USER_ID,
        label: 'ML',
        fileName: 'yash-ml.pdf',
        blobUrl: 'https://example.blob.vercel-storage.com/yash-ml.pdf',
        extractedText: RESUME_TEXT.ml,
      },
      {
        userId: SEED_USER_ID,
        label: 'Full-stack',
        fileName: 'yash-fullstack.pdf',
        blobUrl: 'https://example.blob.vercel-storage.com/yash-fullstack.pdf',
        extractedText: RESUME_TEXT.fullstack,
      },
    ])
    .returning();

  const backendResume = resumeRows.find((r) => r.label === 'Backend');
  await db
    .update(users)
    .set({ defaultResumeId: backendResume?.id ?? null })
    .where(eq(users.clerkUserId, SEED_USER_ID));

  const resumeIdFor = (k: SeedContact['resume']) => {
    const label = k === 'backend' ? 'Backend' : k === 'ml' ? 'ML' : 'Full-stack';
    return resumeRows.find((r) => r.label === label)?.id ?? null;
  };

  const contactRows = await db
    .insert(contacts)
    .values(
      PEOPLE.map((p, i) => ({
        userId: SEED_USER_ID,
        email: p.email,
        firstName: p.firstName,
        lastName: p.lastName,
        company: p.company,
        contactRole: p.contactRole,
        targetRole: p.targetRole,
        hook: p.hook ?? null,
        tags: p.tags ?? [],
        resumeId: resumeIdFor(p.resume),
        source: i % 3 === 0 ? 'csv' : 'manual',
        createdAt: new Date(now - min(60 * 24 * (10 - (i % 10)))),
      })),
    )
    .returning();

  const byEmail = new Map(contactRows.map((c) => [c.email.toLowerCase(), c]));
  const pick = (email: string): ContactRow => {
    const c = byEmail.get(email.toLowerCase());
    if (!c) throw new Error(`seed: missing ${email}`);
    return c;
  };

  const mkSubject = (c: ContactRow) =>
    `Quick note on ${c.company} ${c.targetRole.toLowerCase()} work`;
  const mkBody = (c: ContactRow) =>
    `Hi ${c.firstName},\n\nI've followed ${c.company}'s engineering work for a while, and I'm focusing my search on ${c.targetRole.toLowerCase()} roles. My recent work maps closely to what your team ships.\n\nWould you be open to a short chat this week? Resume attached either way.\n\nThanks,\nYash`;

  const logEvent = async (
    type:
      | 'queued'
      | 'generated'
      | 'gate_passed'
      | 'gate_flagged'
      | 'sending'
      | 'sent'
      | 'failed'
      | 'replied'
      | 'suppressed'
      | 'cancelled',
    c: ContactRow,
    messageId: string | null,
    at: Date,
    payload: Record<string, unknown> = {},
  ) => {
    await db.insert(events).values({
      userId: SEED_USER_ID,
      contactId: c.id,
      messageId,
      type,
      payload,
      createdAt: at,
    });
  };

  const insertMessage = async (
    c: ContactRow,
    opts: {
      step?: number;
      runId?: string | null;
      status: 'draft' | 'needs_review' | 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';
      checkStatus?: 'pending' | 'pass' | 'flag' | 'error';
      sentAt?: Date;
      scheduledFor?: Date;
      errorCode?: string;
      errorMessage?: string;
      checkIssues?: {
        span: string;
        reason: 'unsupported_about_me' | 'unsupported_about_them' | 'fabricated_source';
      }[];
    },
  ) => {
    const id = createId();
    await db.insert(messages).values({
      id,
      userId: SEED_USER_ID,
      contactId: c.id,
      step: opts.step ?? 1,
      runId: opts.runId ?? null,
      status: opts.status,
      checkStatus: opts.checkStatus ?? 'pass',
      checkIssues: opts.checkIssues ?? null,
      subject: mkSubject(c),
      body: mkBody(c),
      model: 'gemini-3.5-flash',
      grounded: true,
      sentAt: opts.sentAt ?? null,
      scheduledFor: opts.scheduledFor ?? null,
      rfcMessageId: opts.status === 'sent' ? `<${id}@warmline.app>` : null,
      errorCode: opts.errorCode ?? null,
      errorMessage: opts.errorMessage ?? null,
      attempts: opts.status === 'sent' || opts.status === 'failed' ? 1 : 0,
      idempotencyKey: `seed-${id}`,
    });
    return id;
  };

  // ── Two days ago: a completed run — 4 sent, one of them since replied ──
  const [oldRun] = await db
    .insert(runs)
    .values({
      userId: SEED_USER_ID,
      kind: 'daily',
      status: 'done',
      plannedCount: 4,
      sentCount: 4,
      startedAt: new Date(now - min(60 * 50)),
      finishedAt: new Date(now - min(60 * 49)),
    })
    .returning();

  const sentOlder = [
    'priya.raman@stripe.com',
    'dmarch@linear.app',
    'j.okafor@ramp.com',
    'lena@temporal.io',
  ];
  for (const [i, email] of sentOlder.entries()) {
    const c = pick(email);
    const at = new Date(now - min(60 * 50 - i * 2));
    const id = await insertMessage(c, { status: 'sent', runId: oldRun?.id ?? null, sentAt: at });
    await db.update(contacts).set({ status: 'sent' }).where(eq(contacts.id, c.id));
    await logEvent('sent', c, id, at);
  }

  // Daniel replied yesterday — pending follow-ups are permanently cancelled.
  const daniel = pick('dmarch@linear.app');
  await db
    .update(contacts)
    .set({ status: 'replied', repliedAt: new Date(now - min(60 * 20)) })
    .where(eq(contacts.id, daniel.id));
  await logEvent('replied', daniel, null, new Date(now - min(60 * 20)), { via: 'manual' });

  // ── Yesterday: one failed send ──
  const failedC = pick('marco@duckdb.org');
  const failedId = await insertMessage(failedC, {
    status: 'failed',
    errorCode: 'SMTP_550',
    errorMessage: 'Recipient address rejected: user unknown',
  });
  await db.update(contacts).set({ status: 'failed' }).where(eq(contacts.id, failedC.id));
  await logEvent('failed', failedC, failedId, new Date(now - min(60 * 22)), { code: 'SMTP_550' });

  // ── One suppressed contact — never emailed again, by anything ──
  const supC = pick('s.almasi@openai.com');
  await db
    .update(contacts)
    .set({ status: 'suppressed', suppressed: true })
    .where(eq(contacts.id, supC.id));
  await db.insert(suppressions).values({
    userId: SEED_USER_ID,
    email: supC.email,
    reason: 'Asked to be contacted via referral portal instead',
  });
  await logEvent('suppressed', supC, null, new Date(now - min(60 * 30)));

  // ── Today's run: in flight — 3 sent, 4 queued, 1 held by the gate ──
  const [todayRun] = await db
    .insert(runs)
    .values({
      userId: SEED_USER_ID,
      kind: 'daily',
      status: 'sending',
      plannedCount: 8,
      sentCount: 3,
      heldCount: 1,
      startedAt: new Date(now - min(9)),
    })
    .returning();
  const runId = todayRun?.id ?? null;

  const sentToday = ['swu@vercel.com', 'tomasz@neon.tech', 'a.beaumont@datadoghq.com'];
  for (const [i, email] of sentToday.entries()) {
    const c = pick(email);
    const at = new Date(now - min(8 - i * 2));
    const id = await insertMessage(c, { status: 'sent', runId, sentAt: at });
    await db.update(contacts).set({ status: 'sent' }).where(eq(contacts.id, c.id));
    await logEvent('sent', c, id, at);
  }

  const queuedToday = [
    'kenji.sato@figma.com',
    'mgold@notion.so',
    'r.iyer@retool.com',
    'oscar@modal.com',
  ];
  for (const [i, email] of queuedToday.entries()) {
    const c = pick(email);
    const at = new Date(now + min(2 + i * 2));
    const id = await insertMessage(c, { status: 'queued', runId, scheduledFor: at });
    await db.update(contacts).set({ status: 'queued' }).where(eq(contacts.id, c.id));
    await logEvent('queued', c, id, new Date(now - min(9)));
  }

  // Held: the gate flagged an unsupported claim; skipped by the drip.
  const heldC = pick('h.tanaka@anthropic.com');
  const heldId = await insertMessage(heldC, {
    status: 'needs_review',
    runId,
    checkStatus: 'flag',
    checkIssues: [
      { span: 'we both spent time at the same lab', reason: 'unsupported_about_me' },
      { span: 'your team tripled in size this spring', reason: 'unsupported_about_them' },
    ],
  });
  await db.update(contacts).set({ status: 'queued' }).where(eq(contacts.id, heldC.id));
  await logEvent('gate_flagged', heldC, heldId, new Date(now - min(9)), { issues: 2 });

  const total = contactRows.length;
  console.log(
    `seed: ${total} contacts, 3 resumes, 3 runs (1 in flight), messages sent/queued/held/failed, 1 replied, 1 suppressed`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
