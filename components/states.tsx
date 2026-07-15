import { AlertCircle, type LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

/** Empty states are an invitation to act, not decoration. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <Icon className="size-7 text-muted" aria-hidden="true" strokeWidth={1.6} />
      <div className="space-y-1">
        <p className="font-medium text-ink">{title}</p>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-error/30 bg-[color-mix(in_srgb,var(--error)_6%,transparent)] px-6 py-10 text-center"
    >
      <AlertCircle className="size-6 text-error" aria-hidden="true" />
      <p className="text-sm text-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
