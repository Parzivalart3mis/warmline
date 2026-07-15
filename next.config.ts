import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@electric-sql/pglite'],
  // Lint runs as its own CI step (`pnpm lint`); keep it out of the build.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/icons/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, immutable' }],
      },
    ];
  },
};

export default withWorkflow(nextConfig);
