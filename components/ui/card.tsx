import * as React from 'react';
import { cn } from '@/lib/utils';

/** Cards get a 1px border, never a drop shadow. */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-lg border bg-surface', className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 p-4 pb-0', className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('text-base font-semibold text-ink', className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-4', className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardContent };
