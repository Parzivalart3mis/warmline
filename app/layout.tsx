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

const splash = (w: number, h: number, r: number) => ({
  url: `/icons/splash-${w * r}x${h * r}.png`,
  media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r})`,
});

export const metadata: Metadata = {
  title: { default: 'Warmline', template: '%s · Warmline' },
  description: 'Personalized job outreach, sent one at a time from your own inbox.',
  applicationName: 'Warmline',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Warmline',
    statusBarStyle: 'default',
    startupImage: [
      splash(440, 956, 3),
      splash(430, 932, 3),
      splash(428, 926, 3),
      splash(414, 896, 3),
      splash(414, 896, 2),
      splash(402, 874, 3),
      splash(393, 852, 3),
      splash(390, 844, 3),
      splash(375, 812, 3),
      splash(375, 667, 2),
    ],
  },
  icons: {
    icon: [
      { url: '/icons/favicon.ico', sizes: '48x48' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  other: {
    // Next 15's appleWebApp.capable emits the standard `mobile-web-app-capable`
    // but NOT Apple's tag — and iOS relies on the Apple tag to keep EVERY
    // in-scope page standalone (not just the launch page). Add it explicitly.
    'apple-mobile-web-app-capable': 'yes',
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
