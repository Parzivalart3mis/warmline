'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isActivePath } from './nav-items';
import { ThemeToggle } from './theme-toggle';

/** Desktop-only primary nav — a persistent left rail. Hidden below lg, where
 *  the bottom nav takes over. */
export function SideNav() {
  const pathname = usePathname();
  return (
    <aside className="ui-chrome fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r bg-surface lg:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <svg width="28" height="28" viewBox="0 0 512 512" aria-hidden="true">
          <rect width="512" height="512" rx="112" fill="var(--bg)" />
          <polygon points="132,288 224,334 132,380" fill="var(--primary)" opacity="0.22" />
          <polygon points="210,210 302,256 210,302" fill="var(--primary)" opacity="0.48" />
          <polygon points="288,132 380,178 288,224" fill="var(--stamp)" />
        </svg>
        <span className="text-lg font-semibold tracking-tight">Warmline</span>
      </div>

      <nav aria-label="Primary" className="flex-1 px-3">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActivePath(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted hover:bg-bg hover:text-ink',
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" strokeWidth={active ? 2.4 : 1.8} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex items-center justify-between border-t px-4 py-3">
        <UserButton appearance={{ elements: { avatarBox: 'size-8' } }} />
        <ThemeToggle />
      </div>
    </aside>
  );
}
