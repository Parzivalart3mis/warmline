'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'ui-chrome inline-flex h-11 w-full items-center gap-1 rounded-md border bg-bg p-1',
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'ui-chrome inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-medium whitespace-nowrap text-muted data-[state=active]:bg-surface data-[state=active]:text-ink',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mt-4', className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
