import type { Metadata, Viewport } from 'next';
import { Inter, Manrope } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'VYRA Admin', template: '%s · VYRA Admin' },
  description: 'VYRA staff console: catalog, inventory, orders and analytics.',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${manrope.variable}`}>
      <body>
        {children}
        <Toaster position="top-right" richColors closeButton toastOptions={{ duration: 4000 }} />
      </body>
    </html>
  );
}
