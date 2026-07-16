'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isActivePath } from './nav-items';

/** Mobile-only primary nav. Hidden at lg+, where the sidebar takes over. */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="ui-chrome pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-surface/95 backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex max-w-xl">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium',
                  active ? 'text-primary' : 'text-muted',
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
  );
}
