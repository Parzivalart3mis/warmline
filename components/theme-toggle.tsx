'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="ui-chrome flex size-11 items-center justify-center rounded-md text-muted active:bg-surface"
    >
      {/* CSS-driven swap keyed off the .dark class next-themes sets pre-paint,
          so the icon can never disagree with the rendered theme. */}
      <Moon className="size-5 dark:hidden" aria-hidden="true" />
      <Sun className="hidden size-5 dark:block" aria-hidden="true" />
    </button>
  );
}
