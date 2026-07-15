import { AlertCircle, PauseCircle, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Status is never conveyed by color alone — every pill has a text label.
 * Because --error and --stamp are close in hue, error states also carry
 * an icon, never color alone.
 */
export type PillStatus =
  | 'not_sent'
  | 'draft'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'replied'
  | 'failed'
  | 'needs_review'
  | 'cancelled'
  | 'suppressed';

const STYLES: Record<
  PillStatus,
  { label: string; className: string; icon?: 'error' | 'held' | 'ban' }
> = {
  not_sent: { label: 'Not sent', className: 'text-muted border-border' },
  draft: { label: 'Draft', className: 'text-muted border-border' },
  queued: {
    label: 'Queued',
    className:
      'text-warning border-warning/30 bg-[color-mix(in_srgb,var(--warning)_9%,transparent)]',
  },
  sending: {
    label: 'Sending',
    className:
      'text-primary border-primary/30 bg-[color-mix(in_srgb,var(--primary)_9%,transparent)]',
  },
  sent: {
    label: 'Sent',
    className:
      'text-success border-success/30 bg-[color-mix(in_srgb,var(--success)_9%,transparent)]',
  },
  replied: {
    label: 'Replied',
    className:
      'text-primary border-primary/30 bg-[color-mix(in_srgb,var(--primary)_9%,transparent)]',
  },
  failed: {
    label: 'Failed',
    className: 'text-error border-error/30 bg-[color-mix(in_srgb,var(--error)_9%,transparent)]',
    icon: 'error',
  },
  needs_review: {
    label: 'Held',
    className:
      'text-warning border-warning/30 bg-[color-mix(in_srgb,var(--warning)_9%,transparent)]',
    icon: 'held',
  },
  cancelled: { label: 'Cancelled', className: 'text-muted border-border' },
  suppressed: { label: 'Suppressed', className: 'text-muted border-border', icon: 'ban' },
};

export function StatusPill({ status, className }: { status: PillStatus; className?: string }) {
  const s = STYLES[status];
  return (
    <span
      className={cn(
        'ui-chrome inline-flex h-6 shrink-0 items-center gap-1 rounded-xl border px-2 font-mono text-xs',
        s.className,
        className,
      )}
    >
      {s.icon === 'error' && <AlertCircle className="size-3" aria-hidden="true" />}
      {s.icon === 'held' && <PauseCircle className="size-3" aria-hidden="true" />}
      {s.icon === 'ban' && <Ban className="size-3" aria-hidden="true" />}
      {s.label}
    </span>
  );
}
