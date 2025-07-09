import type {
  Metadata,
  Viewport,
} from 'next/dist/lib/metadata/types/metadata-interface'

import { Analytics } from '@vercel/analytics/react';
import { Geist, Geist_Mono } from 'next/font/google';
import { AuthProvider } from '@/components/auth-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from 'sonner';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://chat.vercel.ai'),
  title: 'AI Chatbot',
  description: 'AI Chatbot with Supabase Authentication',
};

const geist = Geist({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-mono',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
