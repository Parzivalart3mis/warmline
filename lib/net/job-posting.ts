import { htmlToText } from './html-text';

/**
 * Pulls the job description out of a careers page.
 *
 * Modern ATS sites (Phenom, Greenhouse, Workday, Lever) render the description
 * client-side, so a server-side fetch sees only the page shell — often with a
 * misleading fallback like "this job has been filled". But they almost all
 * publish a schema.org JobPosting in a <script type="application/ld+json">
 * block so Google Jobs can index it. That block is the reliable source, and
 * it's exactly what a naive tag-stripper throws away (it strips <script>
 * first). So: try the structured data, then fall back to visible text.
 */
type JobPosting = { title?: string; description?: string };

/** Decode entities BEFORE stripping tags — descriptions are double-encoded. */
function decodeThenStrip(html: string): string {
  const decoded = html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return decoded
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** Walk a parsed LD+JSON value (object, array, or @graph) for a JobPosting. */
function findJobPosting(node: unknown): JobPosting | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const isJob = Array.isArray(type)
    ? type.some((t) => String(t).includes('JobPosting'))
    : String(type ?? '').includes('JobPosting');
  if (isJob && typeof obj.description === 'string') {
    return {
      ...(typeof obj.title === 'string' ? { title: obj.title } : {}),
      description: obj.description,
    };
  }
  if (obj['@graph']) return findJobPosting(obj['@graph']);
  return null;
}

/** The structured JobPosting, if the page publishes one. */
export function extractJobPostingLd(html: string): JobPosting | null {
  const blocks = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const block of blocks) {
    const raw = block[1]?.trim();
    if (!raw) continue;
    try {
      const found = findJobPosting(JSON.parse(raw));
      if (found) return found;
    } catch {
      // A malformed block is not fatal — try the next one.
    }
  }
  return null;
}

/**
 * Job-posting text for the AI prompts: structured data when available,
 * otherwise the visible page text.
 */
export function jobPostingText(html: string, maxChars = 20_000): string {
  const ld = extractJobPostingLd(html);
  if (ld?.description) {
    const body = decodeThenStrip(ld.description);
    if (body.length > 0) {
      const text = ld.title ? `${ld.title}\n\n${body}` : body;
      return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
    }
  }
  return htmlToText(html, maxChars);
}
