import { and, eq } from 'drizzle-orm';
import type { LanguageModel } from 'ai';
import type { Db } from '@/lib/db';
import { resumes, type Contact, type Resume, type User } from '@/db/schema';
import { selectResume } from '@/lib/ai/select-resume';

export type ResumeChoice = {
  resume: Resume | null;
  /** How we got here — surfaced in events and the digest. */
  via: 'explicit' | 'ai' | 'default' | 'none';
  reason?: string;
};

/**
 * Precedence, deterministic and in code:
 *   1. The operator's explicit pick on the contact always wins.
 *   2. Otherwise, if enabled and there are ≥2 versions plus real signal
 *      (target role or a fetched job posting), let the model choose.
 *   3. Otherwise the user's default resume.
 *
 * AI never overrides an explicit choice, and never blocks: on any failure it
 * falls through to the default.
 */
export async function resolveResumeForDraft(
  db: Db,
  input: {
    user: User;
    contact: Contact;
    jobPostingText?: string;
  },
  deps: { selectModel?: LanguageModel } = {},
): Promise<ResumeChoice> {
  const { user, contact } = input;

  const byId = async (id: string): Promise<Resume | undefined> => {
    const [row] = await db
      .select()
      .from(resumes)
      .where(and(eq(resumes.id, id), eq(resumes.userId, user.clerkUserId)))
      .limit(1);
    return row;
  };

  // 1. Explicit choice on the contact.
  if (contact.resumeId) {
    const explicit = await byId(contact.resumeId);
    if (explicit) return { resume: explicit, via: 'explicit' };
  }

  const all = await db.select().from(resumes).where(eq(resumes.userId, user.clerkUserId));
  const fallback =
    (user.defaultResumeId ? all.find((r) => r.id === user.defaultResumeId) : undefined) ??
    all.find((r) => r.isDefault) ??
    all[0] ??
    null;

  // 2. AI selection — only with the toggle on, multiple versions, and signal.
  if (user.autoSelectResume && all.length > 1) {
    const picked = await selectResume(
      {
        candidates: all.map((r) => ({
          id: r.id,
          label: r.label,
          extractedText: r.extractedText,
        })),
        targetRole: contact.targetRole,
        contactRole: contact.contactRole,
        company: contact.company,
        ...(input.jobPostingText ? { jobPostingText: input.jobPostingText } : {}),
      },
      deps.selectModel ? { model: deps.selectModel } : {},
    );
    if (picked) {
      const chosen = all.find((r) => r.id === picked.id);
      if (chosen) {
        return {
          resume: chosen,
          via: 'ai',
          ...(picked.reason ? { reason: picked.reason } : {}),
        };
      }
    }
  }

  // 3. Default.
  return { resume: fallback, via: fallback ? 'default' : 'none' };
}
