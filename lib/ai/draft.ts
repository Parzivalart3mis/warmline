import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { ResearchFact } from '@/db/schema';
import { draftModel, DRAFT_MODEL_ID, DRAFT_PROVIDER_OPTIONS } from './models';
import { formatToday, tenseRule } from './today';

export const draftSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(2_000),
});

export type Draft = z.infer<typeof draftSchema>;

export type DraftInput = {
  resumeText: string;
  tone: string;
  contact: {
    firstName: string;
    lastName: string;
    company: string;
    contactRole: string;
    targetRole: string;
    hook?: string | null;
  };
  facts: ResearchFact[];
  jobPostingText?: string;
  /** For follow-ups: the full previous message in the thread. */
  previous?: { subject: string; body: string; sentAt?: Date | null };
  step: number;
  /** "Now" for temporal reasoning; defaults to the current date. */
  now?: Date;
};

/**
 * The prompt is split so the streaming route (§7.2 individual send) and the
 * batch path share one source of truth. Resume text goes FIRST and unchanged
 * between calls — a stable prefix means Gemini's implicit context caching
 * makes repeat reads ~10% of base input cost.
 */
export function draftPrompt(input: DraftInput): { system: string; prompt: string } {
  const system = [
    'You draft short, genuinely personal job-outreach emails. The sender is a real person writing to one specific human; the result must read like it was written for that one person.',
    '',
    '── FORMAT ──',
    '- Plain text with paragraph breaks. No HTML, no markdown, no emoji, no bullet lists.',
    '- Under 180 words.',
    '- Subject line: under 8 words, must contain the role name or the specific hook. Never use "opportunity", "exploring", "inquiry", or "connecting".',
    "- End with a single low-pressure ask and sign off with the sender's first name.",
    '',
    '── GROUNDING (hard rules) ──',
    '- Every claim about the SENDER must be supported by the resume text.',
    '- Every claim about the RECIPIENT or their company must be supported by the provided facts or job posting.',
    '- No invented names, numbers, dates, or mutual connections. When in doubt, leave it out.',
    `- ${tenseRule(formatToday(input.now))}`,
    '',
    '── HOOK (opening paragraph) ──',
    '- Open with the single strongest specific connection between sender and recipient: shared domain, overlapping employer history, their team\'s work, or the target role itself.',
    "- Company facts must serve the sender's case for fit. If a fact cannot be tied to the sender's experience in one natural sentence, omit it entirely. Never use a fact as standalone flattery.",
    '',
    '── THE ASK ──',
    '- Exactly one ask, answerable in a single reply. Allowed types: (a) a referral for a named role, (b) a pointer to the right team or person, (c) a resume review.',
    '- Never ask for a call, meeting, coffee chat, or "brief conversation".',
    '- Close the ask with an easy out (e.g. "either way, thanks for reading").',
    '',
    '── BANNED PHRASES ──',
    '"I hope this email finds you well" (and variants), "I wanted to reach out", "I came across your profile", "I\'m excited", "thrilled", "passionate", "leverage", "utilize", "spearhead", "synergy", "ecosystem", "I would love the opportunity", "align/alignment", "resonate". No em dashes. No rule-of-three lists ("X, Y, and Z" used for rhetorical effect).',
    '',
    '── TONE ──',
    `- Tone: ${input.tone}. Let that set the register — warm-direct means contractions and plain words; formal means neither.`,
    '- Confident, never salesy. Specific numbers from the resume beat adjectives ("cut deployments from 25 min to 5" beats "significantly improved deployments").',
    '',
    '── SELF-CHECK (before returning) ──',
    'Verify every sentence against these rules. Delete any sentence that fails grounding, uses a banned phrase, or serves neither the hook, the proof, nor the ask.',
  ].join('\n');

  const factLines =
    input.facts.length > 0
      ? input.facts.map((f) => `- ${f.claim} (source: ${f.sourceUrl})`).join('\n')
      : '(none — do not invent any company facts)';

  const followUp = input.previous
    ? [
        `This is follow-up number ${input.step - 1} in an existing thread. The previous message (sent earlier, no reply yet) was:`,
        `Subject: ${input.previous.subject}`,
        input.previous.body,
        `Write a brief, graceful follow-up — under 120 words, no guilt-tripping, adds one new angle instead of repeating. The subject MUST be exactly "Re: ${input.previous.subject}".`,
      ].join('\n\n')
    : '';

  const prompt = [
    `SENDER'S RESUME:\n${input.resumeText}`,
    `RECIPIENT:\n${input.contact.firstName} ${input.contact.lastName}`.trim() +
      `\n${input.contact.contactRole || 'Unknown role'} at ${input.contact.company || 'their company'}`,
    `SENDER'S TARGET ROLE: ${input.contact.targetRole || 'not specified'}`,
    input.contact.hook ? `PERSONAL HOOK (from the sender's notes): ${input.contact.hook}` : '',
    `COMPANY FACTS (grounded):\n${factLines}`,
    input.jobPostingText ? `JOB POSTING:\n${input.jobPostingText.slice(0, 6_000)}` : '',
    followUp,
    'Write the email now. Return subject and body.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { system, prompt };
}

export async function generateDraft(
  input: DraftInput,
  deps: { model?: LanguageModel } = {},
): Promise<Draft & { model: string }> {
  const { system, prompt } = draftPrompt(input);
  const result = await generateObject({
    model: deps.model ?? draftModel(),
    schema: draftSchema,
    system,
    prompt,
    providerOptions: DRAFT_PROVIDER_OPTIONS,
  });
  const draft = result.object;
  // Deterministic guarantee, not a hope: follow-ups thread under Re: <original>.
  if (input.previous) {
    const expected = `Re: ${input.previous.subject}`;
    if (draft.subject !== expected) draft.subject = expected;
  }
  return { ...draft, model: DRAFT_MODEL_ID };
}
