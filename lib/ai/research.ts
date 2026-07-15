import { generateText, generateObject, type LanguageModel } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import type { ResearchFact } from '@/db/schema';
import { researchModel } from './models';

/**
 * Grounded company research (§7.1). Two passes because search grounding and
 * structured output don't mix in one call: (1) grounded generateText collects
 * findings + real source URLs, (2) a structuring pass shapes them. Every fact
 * must carry a source URL drawn from the actual grounding sources (or the
 * fetched job posting) — anything else is discarded in code, not by trust.
 *
 * Research is best-effort context; the faithfulness gate is the enforcement
 * point. On any model failure this returns [].
 */
const FRESH_DAYS = 14;

export function isResearchFresh(researchedAt: Date | null | undefined, now = new Date()): boolean {
  if (!researchedAt) return false;
  return now.getTime() - researchedAt.getTime() < FRESH_DAYS * 24 * 3_600_000;
}

export const researchStructureSchema = z.object({
  facts: z
    .array(
      z.object({
        claim: z.string().min(1).max(300),
        sourceUrl: z.string().max(2048),
      }),
    )
    .max(3),
});

export type ResearchInput = {
  company: string;
  contactRole?: string;
  targetRole?: string;
  jobPostingText?: string;
  jobUrl?: string;
};

export type ResearchDeps = {
  groundedModel?: LanguageModel;
  structuringModel?: LanguageModel;
};

export async function researchCompany(
  input: ResearchInput,
  deps: ResearchDeps = {},
): Promise<ResearchFact[]> {
  const groundedModel = deps.groundedModel ?? researchModel();
  const structuringModel = deps.structuringModel ?? researchModel();

  try {
    const grounded = await generateText({
      model: groundedModel,
      tools: { google_search: google.tools.googleSearch({}) },
      prompt: [
        `Research the company "${input.company}" for a job-outreach email. Prefer SEARCH over memory for anything time-sensitive — funding, launches, headcount, the job posting itself. A stale funding round is worse than saying nothing.`,
        input.targetRole ? `The sender is targeting a ${input.targetRole} role there.` : '',
        input.jobPostingText
          ? `Job posting text (already fetched, treat as primary):\n${input.jobPostingText.slice(0, 6_000)}`
          : '',
        'Report up to 5 short, recent, concrete findings as bullet points. Note which search result supports each finding. If you find nothing reliable, say so.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

    const allowedUrls = new Set<string>();
    for (const source of grounded.sources) {
      if (source.sourceType === 'url' && source.url) allowedUrls.add(source.url);
    }
    if (input.jobUrl) allowedUrls.add(input.jobUrl);
    if (allowedUrls.size === 0) return [];

    const structured = await generateObject({
      model: structuringModel,
      schema: researchStructureSchema,
      prompt: [
        'Turn these research findings into at most 3 facts for a personalized outreach email.',
        'Rules: each fact must be one specific, recent, verifiable claim; sourceUrl must be copied EXACTLY from the source list below; skip any finding without a matching source.',
        `Findings:\n${grounded.text.slice(0, 6_000)}`,
        `Source list:\n${[...allowedUrls].join('\n')}`,
      ].join('\n\n'),
    });

    return structured.object.facts
      .filter((f) => allowedUrls.has(f.sourceUrl))
      .slice(0, 3)
      .map((f) => ({ claim: f.claim, sourceUrl: f.sourceUrl }));
  } catch {
    return [];
  }
}
