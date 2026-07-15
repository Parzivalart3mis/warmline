import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { SignInButton } from '@clerk/nextjs';

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect('/queue');

  return (
    <main className="pb-safe pt-safe mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6">
      <div className="space-y-3">
        <svg width="56" height="56" viewBox="0 0 512 512" aria-hidden="true">
          <rect width="512" height="512" rx="112" fill="var(--surface)" />
          <polygon points="132,288 224,334 132,380" fill="var(--primary)" opacity="0.22" />
          <polygon points="210,210 302,256 210,302" fill="var(--primary)" opacity="0.48" />
          <polygon points="288,132 380,178 288,224" fill="var(--stamp)" />
        </svg>
        <h1 className="text-3xl font-semibold tracking-tight">Warmline</h1>
        <p className="text-lg text-muted">
          Personalized job outreach, sent one at a time from your own inbox.
        </p>
      </div>
      <div>
        <SignInButton>
          <button className="ui-chrome min-h-11 rounded-md bg-primary px-6 text-base font-medium text-primary-foreground">
            Sign in
          </button>
        </SignInButton>
      </div>
    </main>
  );
}
