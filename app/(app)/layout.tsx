import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { BottomNav } from '@/components/bottom-nav';
import { SideNav } from '@/components/side-nav';
import { devFakeUserActive } from '@/lib/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!devFakeUserActive()) {
    const { userId } = await auth();
    if (!userId) redirect('/');
  }

  return (
    <div className="min-h-dvh">
      {/* Desktop: persistent left rail. Mobile: hidden (bottom nav instead). */}
      <SideNav />
      {/* Content is offset by the sidebar on desktop, and leaves room for the
          bottom nav only on mobile. */}
      <div className="pb-28 lg:pb-0 lg:pl-64">{children}</div>
      <BottomNav />
    </div>
  );
}
