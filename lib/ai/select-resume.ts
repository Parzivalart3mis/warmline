import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { gateModel, GATE_PROVIDER_OPTIONS } from './models';

/**
 * Picks the best-fitting resume version for a contact when the operator hasn't
 * chosen one explicitly. Cheap model, minimal thinking — this is a
 * classification, not a composition.
 *
 * Fails open: any error, or a model that invents an id, returns null so the
 * caller falls back to the user's default resume. Never blocks a send.
 */
export type ResumeCandidate = {
  id: string;
  label: string;
  extractedText: string;
};

export type SelectResumeInput = {
  candidates: ResumeCandidate[];
  targetRole: string;
  contactRole?: string;
  company?: string;
  jobPostingText?: string;
};

const selectionSchema = z.object({
  resumeLabel: z.string().min(1).max(120),
  reason: z.string().max(200).optional(),
});

/** Is there enough signal to make a meaningful choice? */
export function hasSelectionSignal(input: {
  targetRole?: string;
  jobPostingText?: string;
}): boolean {
  return Boolean(input.targetRole?.trim() || input.jobPostingText?.trim());
}

export async function selectResume(
  input: SelectResumeInput,
  deps: { model?: LanguageModel } = {},
): Promise<{ id: string; label: string; reason?: string } | null> {
  if (input.candidates.length < 2) return null;
  if (!hasSelectionSignal(input)) return null;

  const options = input.candidates
    .map((c) => `LABEL: ${c.label}\nSUMMARY: ${c.extractedText.slice(0, 1200)}`)
    .join('\n\n---\n\n');

  try {
    const result = await generateObject({
      model: deps.model ?? gateModel(),
      schema: selectionSchema,
      providerOptions: GATE_PROVIDER_OPTIONS,
      prompt: [
        'Pick which resume version best fits this outreach target. Answer with the LABEL of exactly one of the provided resumes — never invent a label.',
        `TARGET ROLE THE SENDER WANTS: ${input.targetRole || 'not specified'}`,
        input.company ? `COMPANY: ${input.company}` : '',
        input.contactRole ? `RECIPIENT'S ROLE: ${input.contactRole}` : '',
        input.jobPostingText ? `JOB POSTING:\n${input.jobPostingText.slice(0, 4_000)}` : '',
        `RESUME VERSIONS:\n\n${options}`,
        'Choose the version whose experience most directly matches the target role and job posting. Give a one-line reason.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

    // Match by label, case-insensitively — and only ever return a real row.
    const wanted = result.object.resumeLabel.trim().toLowerCase();
    const match = input.candidates.find((c) => c.label.trim().toLowerCase() === wanted);
    if (!match) return null;

    return {
      id: match.id,
      label: match.label,
      ...(result.object.reason ? { reason: result.object.reason } : {}),
    };
  } catch {
    return null;
  }
}
