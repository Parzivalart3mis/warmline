# Warmline

A private, single-operator job-outreach PWA. It holds your resume versions and
contact list, drafts a genuinely personalized email per contact, and releases
them from your own Gmail — one every couple of minutes inside a window you
choose — so every recipient gets a message that reads like you sat down and
wrote it, because functionally you did.

Open it on the train and it feels like a departures board: paper-white, quiet,
everything still except a single red hairline creeping across one row — the
email going out right this second.

## How it works

- **Draft.** Per contact, a Gemini model reads your selected resume, the
  contact's details, grounded company research, and (optionally) the job
  posting, then writes a short plain-text letter.
- **Gate.** A separate faithfulness check verifies every claim about you is
  supported by your resume and every claim about them by a grounded source.
  Because sending is automatic, this **blocks** — a flagged draft is held for
  your review and never sends on its own.
- **Drip.** A [Vercel Workflow](https://useworkflow.dev) plans the day, sleeps
  until your local send time (DST-correct), emails you a digest of exactly what
  is about to go out, waits a 10-minute grace period, then sends one email every
  ~2 minutes (± jitter). The workflow suspends in `sleep()` consuming no compute
  and survives deploys.
- **Board.** The Queue shows who's been reached and who's still waiting. Mark a
  contact replied to cancel their follow-ups; suppress one to never email them
  again.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript strict · Vercel Workflows ·
Neon Postgres + Drizzle · Clerk · Nodemailer + Gmail SMTP · Vercel AI SDK +
Gemini · Vercel Blob · Upstash Ratelimit · Tailwind + shadcn/ui · PGlite (tests).

## Local development

```bash
pnpm install
cp .env.example .env.local     # fill in what you have
pnpm db:seed                   # seeds an embedded PGlite db (no Postgres needed)
pnpm dev
```

With no `DATABASE_URL`, the app uses an embedded **PGlite** database persisted
in `.pglite/` — no Postgres, no Docker. Set `DATABASE_URL` to a Neon connection
string to use real Postgres.

**Running the UI without real Clerk keys:** set `DEV_FAKE_USER=1` in
`.env.local` (already there after setup). In development only, this signs every
request in as the seed operator so you can drive the whole app offline. It is
impossible to enable in production (guarded by `NODE_ENV`).

**Exercising the drip locally:** set `WORKFLOW_MODE=inline`. Vercel Workflows
don't run outside Vercel, so this runs the same plan → prepare → digest → drip
sequence inline with compressed sleeps. Mail goes to an in-process
`FakeMailSender` (inspect it at `/api/dev/outbox`) unless `ENABLE_REAL_SMTP=1`.

## Proving the risky pieces first

Two things could sink the architecture, so prove them before building on top:

```bash
# 1. Real SMTP: sends one email from GMAIL_USER to yourself.
#    Confirm it arrives, lands in your Gmail Sent folder, and threads on reply.
pnpm tsx scripts/smtp-spike.ts

# 2. Durable sleep: deploy, POST /api/spike/workflow with the CRON_SECRET,
#    push a new deploy mid-run, and confirm it completes in
#    Vercel → Observability → Workflows.
```

If SMTP fails with `SMTP_535` on a Google **Workspace** account, App Passwords
are unavailable — swap `GmailSmtpSender` for a `GmailOAuthSender` behind the
`MailSender` interface (`lib/mail/sender.ts`); it's a one-file change.

## Gmail App Password

Requires a **personal @gmail.com** with 2-Step Verification on. Generate a
16-character App Password at
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
and set `GMAIL_USER` + `GMAIL_APP_PASSWORD`. `GMAIL_USER` **must** match the
email of your Clerk account — the app refuses to send if they differ.

## Scripts

| Script             | What it does                                              |
| ------------------ | -------------------------------------------------------- |
| `pnpm dev`         | Local Next.js dev server                                 |
| `pnpm build`       | Production build                                          |
| `pnpm typecheck`   | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`)      |
| `pnpm lint`        | ESLint + input-font check + AA contrast check            |
| `pnpm test`        | Vitest (unit + PGlite integration); `--coverage` for %   |
| `pnpm test:e2e`    | Playwright (env-gated; see below)                        |
| `pnpm db:generate` | Generate a Drizzle migration                             |
| `pnpm db:migrate`  | Apply migrations                                         |
| `pnpm db:seed`     | Seed a realistic operator + ~25 contacts                 |
| `pnpm db:studio`   | Drizzle Studio                                           |
| `pnpm icons`       | Regenerate the icon set from `public/icons/icon.svg`     |

## Testing

- **Unit** (`tests/unit`): schemas, the SSRF guard, DST-correct time math,
  jitter, the CSV parser, the faithfulness-gate parser, mail, formatters.
- **Integration** (`tests/integration`, in-process PGlite — no Docker): the
  compare-and-swap send claim (fire twice, assert one send), the partial unique
  indexes, three-checkpoint suppression, reply-cancels-follow-ups, cross-user
  isolation through the real route handlers, `planRun` caps/window/weekends, and
  the full inline pipeline with mock models.
- **E2E** (`tests/e2e`, Playwright): three flows against a deployed target.
  Opt-in — set `E2E_BASE_URL`, `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD`;
  without them the specs skip.

`pnpm test --coverage` enforces ≥80% on `lib/`.

## Deployment (Vercel + Neon)

1. Create a Neon project; set `DATABASE_URL` to the pooled connection string.
2. Set every var from `.env.example` in the Vercel project (Production).
3. `drizzle-kit migrate` runs as a build step (see `vercel.json`).
4. The daily cron (`/api/cron/daily`, guarded by `CRON_SECRET`) fires at 06:00
   UTC and only *starts* the workflow; the workflow sleeps until your real local
   send time. On Hobby, cron is once/day and UTC-only — this is the only
   DST-correct design available there.

Before pointing it at a real contact, run one full daily cycle against three of
your own email addresses.

## Security notes

- Every DB query is scoped by `userId`, deny-by-default; a cross-user isolation
  test enforces it.
- Suppression is checked at three independent points (query layer, planner, and
  in `sendOne` immediately before the wire).
- The job-URL fetcher (`lib/net/safe-fetch.ts`) is SSRF-guarded: https-only,
  DNS resolved and re-checked against private ranges after every redirect, 5s
  timeout, 2MB streamed cap, text-only content types.
- Credentials live only in env vars; email bodies and recipient addresses are
  never logged.
