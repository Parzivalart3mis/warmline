import { Send, Users, FileText, Settings, type LucideIcon } from 'lucide-react';

/** Single source of truth for the primary destinations — shared by the mobile
 *  bottom nav and the desktop sidebar so they can never drift. */
export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { href: '/queue', label: 'Queue', icon: Send },
  { href: '/contacts', label: 'Contacts', icon: Users },
  { href: '/drafts', label: 'Drafts', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
