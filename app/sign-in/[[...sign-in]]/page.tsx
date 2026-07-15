import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <main className="pb-safe pt-safe flex min-h-dvh items-center justify-center px-4">
      <SignIn />
    </main>
  );
}
