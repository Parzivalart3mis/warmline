import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/api/health',
  '/api/cron/daily',
  '/manifest.webmanifest',
  '/sw.js',
  '/icons(.*)',
]);

function buildCsp(nonce: string) {
  const dev = process.env.NODE_ENV !== 'production';
  const scriptSrc = dev
    ? `'self' 'unsafe-eval' 'unsafe-inline' https:`
    : `'self' 'nonce-${nonce}' 'strict-dynamic' https:`;
  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https://img.clerk.com https://*.public.blob.vercel-storage.com`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.clerk.accounts.dev https://clerk.warmline.app https://*.public.blob.vercel-storage.com ${dev ? 'ws:' : ''}`,
    `worker-src 'self' blob:`,
    `frame-src https://challenges.cloudflare.com`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
  ]
    .join('; ')
    .trim();
}

export default clerkMiddleware(async (auth, req) => {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  // Dev-only: DEV_FAKE_USER signs every request in as the seed operator so the
  // app can be driven locally without real Clerk keys. Impossible in prod.
  const devFakeUser =
    process.env.NODE_ENV === 'development' && process.env.DEV_FAKE_USER === '1';

  if (!devFakeUser && !isPublicRoute(req)) {
    const { userId, redirectToSignIn } = await auth();
    if (!userId) {
      if (req.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'Sign in required.' } },
          { status: 401 },
        );
      }
      return redirectToSignIn();
    }
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('content-security-policy', csp);
  return res;
});

export const config = {
  matcher: [
    // Skip Next.js internals, static assets, and Workflow SDK internal paths.
    '/((?!_next|\\.well-known/workflow/|icons/|sw\\.js|manifest\\.webmanifest|.*\\.(?:png|ico|svg|jpg|jpeg|webp|woff2?)$).*)',
    '/(api|trpc)(.*)',
  ],
};
