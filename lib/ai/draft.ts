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
    'Hard rules:',
    '- Plain text with paragraph breaks. No HTML, no markdown, no emoji, no bullet lists.',
    '- Under 180 words.',
    '- Never open with "I hope this email finds you well" or any variant.',
    '- Every claim about the SENDER must be supported by the resume text.',
    '- Every claim about the RECIPIENT or their company must be supported by the provided facts or job posting.',
    '- No invented names, numbers, dates, or mutual connections. When in doubt, leave it out.',
    `- ${tenseRule(formatToday(input.now))}`,
    "- End with a single, low-pressure ask and sign off with the sender's first name.",
    `- Tone: ${input.tone}.`,
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
