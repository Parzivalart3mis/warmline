'use client';

import { UserButton } from '@clerk/nextjs';
import { ThemeToggle } from './theme-toggle';

export function AppBar({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <header className="ui-chrome pt-safe sticky top-0 z-30 border-b bg-bg/95 backdrop-blur lg:bg-bg/80">
      <div className="mx-auto flex h-14 max-w-xl items-center justify-between gap-3 px-4 lg:h-16 lg:max-w-3xl lg:px-8">
        <h1 className="text-xl font-semibold tracking-tight lg:text-2xl">{title}</h1>
        <div className="flex items-center gap-1">
          {action}
          {/* Theme + account live in the sidebar on desktop. */}
          <div className="flex items-center gap-1 lg:hidden">
            <ThemeToggle />
            <UserButton appearance={{ elements: { avatarBox: 'size-8' } }} />
          </div>
        </div>
      </div>
    </header>
  );
}
