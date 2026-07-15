import * as React from 'react';
import { cn } from '@/lib/utils';

/** Form controls are always ≥16px — iOS zooms on focus below that. */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-11 w-full min-w-0 rounded-md border bg-surface px-3 py-2 text-base text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
