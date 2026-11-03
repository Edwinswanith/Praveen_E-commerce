import type { Metadata, Viewport } from 'next';
import { Inter, Manrope } from 'next/font/google';
import type { CategoryNode } from '@vyra/shared';
import { Providers } from '@/components/providers';
import { AnnouncementBar } from '@/components/layout/announcement-bar';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { serverFetch } from '@/lib/server-api';
import { SITE_URL } from '@/lib/site';
import { toNav } from '@/lib/categories';
import './globals.css';
import { FREE_SHIPPING_TEXT, RETURN_DAYS } from '@/lib/store-promises';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
  weight: ['500', '600', '700', '800'],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'VYRA — Wear Your Vibe. Online fashion for Men, Women & Kids',
    template: '%s | VYRA',
  },
  description:
    `Shop the latest fashion at VYRA: t-shirts, shirts, dresses, kurtas, denim and accessories for men, women and kids. Free shipping over ${FREE_SHIPPING_TEXT}, easy ${RETURN_DAYS}-day returns.`,
  applicationName: 'VYRA',
  keywords: [
    'fashion',
    'online shopping India',
    'clothing',
    'VYRA',
    'men fashion',
    'women fashion',
    'kids wear',
  ],
  openGraph: { type: 'website', siteName: 'VYRA', locale: 'en_IN', url: SITE_URL },
  twitter: { card: 'summary_large_image' },
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#ff3f6c',
  width: 'device-width',
  initialScale: 1,
  // Lets the sticky add-to-bag bar use env(safe-area-inset-bottom) on notched iPhones.
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const res = await serverFetch<CategoryNode[]>('/categories', {
    revalidate: 300,
    timeoutMs: 4000,
  });
  const categories = res.ok ? res.data : [];
  return (
    <html lang="en-IN" className={`${inter.variable} ${manrope.variable}`}>
      <body className="flex min-h-dvh flex-col bg-bg font-sans text-fg antialiased">
        <a
          href="#main"
          className="sr-only z-[60] rounded-md bg-fg px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <Providers>
          <AnnouncementBar />
          <Header initialCategories={categories} />
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer categories={toNav(categories)} />
        </Providers>
      </body>
    </html>
  );
}
