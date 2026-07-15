import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Tap targets ≥44×44. Buttons are UI chrome (no text selection).
 * Note: --stamp (airmail red) is deliberately NOT a button variant.
 */
const buttonVariants = cva(
  'ui-chrome inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-base font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground active:opacity-90',
        secondary: 'border bg-surface text-ink active:bg-bg',
        ghost: 'text-primary active:bg-bg',
        destructive: 'border border-error/40 bg-surface text-error active:bg-bg',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-11 px-3 text-sm',
        lg: 'h-12 px-6',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
