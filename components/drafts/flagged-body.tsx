import type { GateIssue } from '@/db/schema';

const REASON_LABEL: Record<GateIssue['reason'], string> = {
  unsupported_about_me: 'Not supported by your resume',
  unsupported_about_them: 'Not supported by any grounded fact',
  fabricated_source: 'Invented source',
};

/**
 * Renders the email body with flagged spans underlined in stamp red. Because
 * --error and --stamp are close in hue, each highlight also gets a caption
 * explaining why — never color alone.
 */
export function FlaggedBody({ body, issues }: { body: string; issues: GateIssue[] }) {
  if (issues.length === 0) {
    return <p className="font-email whitespace-pre-wrap">{body}</p>;
  }

  const spans = issues.map((i) => i.span).filter(Boolean);
  const pattern = new RegExp(`(${spans.map(escapeRegExp).join('|')})`, 'g');
  const parts = body.split(pattern);

  return (
    <div className="space-y-3">
      <p className="font-email whitespace-pre-wrap">
        {parts.map((part, i) => {
          const issue = issues.find((issue) => issue.span === part);
          return issue ? (
            <mark
              key={i}
              className="rounded-sm bg-[color-mix(in_srgb,var(--stamp)_18%,transparent)] px-0.5 underline decoration-stamp decoration-wavy underline-offset-2"
              title={REASON_LABEL[issue.reason]}
            >
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          );
        })}
      </p>
      <ul className="space-y-1 text-xs text-muted">
        {issues.map((issue, i) => (
          <li key={i}>
            <span className="text-stamp">“{issue.span}”</span> — {REASON_LABEL[issue.reason]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
