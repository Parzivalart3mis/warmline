import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { BottomNav } from '@/components/bottom-nav';
import { devFakeUserActive } from '@/lib/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!devFakeUserActive()) {
    const { userId } = await auth();
    if (!userId) redirect('/');
  }

  return (
    <div className="mx-auto min-h-dvh max-w-xl pb-28">
      {children}
      <BottomNav />
    </div>
  );
}
