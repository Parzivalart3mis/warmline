'use client';

import { UserButton } from '@clerk/nextjs';
import { ThemeToggle } from './theme-toggle';

export function AppBar({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className="ui-chrome pt-safe sticky top-0 z-30 border-b bg-bg/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-xl items-center justify-between gap-3 px-4">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <div className="flex items-center gap-1">
          {action}
          <ThemeToggle />
          <UserButton appearance={{ elements: { avatarBox: 'size-8' } }} />
        </div>
      </div>
    </header>
  );
}
