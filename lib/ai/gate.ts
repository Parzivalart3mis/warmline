import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { GateIssue, ResearchFact } from '@/db/schema';
import { gateModel, GATE_PROVIDER_OPTIONS } from './models';
import { formatToday, tenseRule } from './today';

/**
 * §7.3 — the faithfulness gate. Sending is fully automatic, so this is the
 * only thing standing between a hallucination and the operator's name on it.
 * It is a GATE, not a suggestion: on `flag` the message is held; if the gate
 * itself errors twice, the message is held. Fail closed.
 */
/**
 * `span` is model-generated free text, so it carries no length cap: a hard
 * `.max()` would turn an over-long quote into a total generation failure,
 * which the caller treats as a gate error and holds a message that was
 * probably fine. Length is clamped after parsing instead. The enums stay
 * strict — those are the parts that must not drift.
 */
export const gateSchema = z.object({
  verdict: z.enum(['pass', 'flag']),
  issues: z
    .array(
      z.object({
        span: z.string().min(1),
        reason: z.enum(['unsupported_about_me', 'unsupported_about_them', 'fabricated_source']),
      }),
    )
    .max(20),
});

const MAX_SPAN = 300;

export type GateResult = {
  verdict: 'pass' | 'flag' | 'error';
  issues: GateIssue[];
};

export type GateInput = {
  subject: string;
  body: string;
  resumeText: string;
  facts: ResearchFact[];
  jobPostingText?: string;
  /** "Now" for temporal reasoning; defaults to the current date. */
  now?: Date;
};

export function gateMode(): 'block' | 'warn' {
  return process.env.AI_GATE_MODE === 'warn' ? 'warn' : 'block';
}

export async function runGate(
  input: GateInput,
  deps: { model?: LanguageModel; attempts?: number } = {},
): Promise<GateResult> {
  const attempts = deps.attempts ?? 2;
  const prompt = [
    'You are a fact-check gate for an outbound email. Check every factual claim in the draft:',
    '- Claims about the SENDER must be supported by the resume text.',
    '- Claims about the RECIPIENT or their company must be supported by the grounded facts (with their source URLs) or the job posting.',
    '- Any invented name, number, date, or mutual connection is a violation.',
    `- ${tenseRule(formatToday(input.now))} A claim that the sender is "currently" studying or working somewhere whose resume date-range has already ended is UNSUPPORTED — flag it as unsupported_about_me.`,
    'Verdict "pass" only if every claim is supported. Otherwise "flag" and list each offending span (quote the exact words from the draft) with its reason.',
    `DRAFT SUBJECT: ${input.subject}`,
    `DRAFT BODY:\n${input.body}`,
    `RESUME:\n${input.resumeText}`,
    `GROUNDED FACTS:\n${
      input.facts.length > 0
        ? input.facts.map((f) => `- ${f.claim} (source: ${f.sourceUrl})`).join('\n')
        : '(none — every company-specific claim is unsupported)'
    }`,
    input.jobPostingText ? `JOB POSTING:\n${input.jobPostingText.slice(0, 6_000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await generateObject({
        model: deps.model ?? gateModel(),
        schema: gateSchema,
        prompt,
        providerOptions: GATE_PROVIDER_OPTIONS,
      });
      const { verdict } = result.object;
      const issues = result.object.issues.map((i) => ({
        ...i,
        span: i.span.slice(0, MAX_SPAN),
      }));
      // Defensive: a "pass" that lists issues is a flag.
      if (verdict === 'pass' && issues.length > 0) {
        return { verdict: 'flag', issues };
      }
      return { verdict, issues };
    } catch (err) {
      // Fails closed (holds the message) — so make the reason visible.
      console.warn(
        `[gate] attempt ${attempt}/${attempts} failed:`,
        err instanceof Error ? `${err.name}: ${err.message.split('\n')[0]}` : err,
      );
      if (attempt === attempts) {
        return { verdict: 'error', issues: [] };
      }
    }
  }
  return { verdict: 'error', issues: [] };
}
