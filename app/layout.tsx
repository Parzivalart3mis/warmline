import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Newsreader, IBM_Plex_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import { ClerkProvider } from '@clerk/nextjs';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { RegisterSW } from '@/components/register-sw';
import './globals.css';

const instrument = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument',
});

const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
});

const SPLASH_SIZES: Array<[number, number, number]> = [
  [440, 956, 3],
  [430, 932, 3],
  [428, 926, 3],
  [414, 896, 3],
  [414, 896, 2],
  [402, 874, 3],
  [393, 852, 3],
  [390, 844, 3],
  [375, 812, 3],
  [375, 667, 2],
];

/**
 * PWA-critical tags are deliberately NOT in the `metadata` export. Next 15
 * streams metadata for dynamic pages into the <body> (hoisted to <head> only
 * after hydration) — but Safari's "Add to Home Screen" parses the initial
 * server-rendered head. With these tags streamed, iOS never saw the manifest
 * or the apple-* metas: the web clip was named after the page title
 * ("Queue · Warmline") and every non-start route opened with browser chrome.
 * Rendering them as literal JSX in the root layout (part of the synchronous
 * shell) makes React hoist them into the streamed head, where Safari reads
 * them. Guarded by tests/unit/layout-metadata.test.ts.
 */
function PwaHeadTags() {
  return (
    <>
      <link rel="manifest" href="/manifest.webmanifest" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Warmline" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      {SPLASH_SIZES.map(([w, h, r]) => (
        <link
          key={`${w}x${h}@${r}`}
          rel="apple-touch-startup-image"
          href={`/icons/splash-${w * r}x${h * r}.png`}
          media={`(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r})`}
        />
      ))}
    </>
  );
}

export const metadata: Metadata = {
  title: { default: 'Warmline', template: '%s · Warmline' },
  description: 'Personalized job outreach, sent one at a time from your own inbox.',
  applicationName: 'Warmline',
  icons: {
    icon: [
      { url: '/icons/favicon.ico', sizes: '48x48' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F5F4F0' },
    { media: '(prefers-color-scheme: dark)', color: '#141513' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // no pinch-zoom — feels native, not like a webpage
  viewportFit: 'cover', // content respects iPhone safe areas
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <ClerkProvider afterSignOutUrl="/">
      <html lang="en" suppressHydrationWarning>
        <body
          className={`${instrument.variable} ${newsreader.variable} ${plexMono.variable} font-sans`}
        >
          <PwaHeadTags />
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
            {...(nonce ? { nonce } : {})}
          >
            {children}
            <Toaster position="top-center" richColors={false} />
            <RegisterSW />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
