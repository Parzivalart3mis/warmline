'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'ui-chrome inline-flex h-7 w-12 shrink-0 items-center rounded-xl border border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-border',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-6 rounded-xl bg-surface transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
