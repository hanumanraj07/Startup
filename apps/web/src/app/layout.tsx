import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth-context';
import { PwaInstallBanner } from '@/components/pwa-install-banner';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: 'OnSite — someone on the ground, wherever you need them',
    template: '%s · OnSite',
  },
  description:
    'Get a verified local person to inspect, verify, or collect something anywhere in India. Funds held in escrow, released only when you approve the evidence.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/favicon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'OnSite',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1116' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AuthProvider>
          <PwaInstallBanner />
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
