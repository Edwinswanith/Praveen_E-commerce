import Link from 'next/link';
import { RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import { VyraLogo } from '@vyra/ui';
import type { NavCategory } from '@/lib/categories';
import { NewsletterForm } from './newsletter-form';
import { FREE_SHIPPING_TEXT, RETURN_DAYS } from '@/lib/store-promises';

export function Footer({ categories }: { categories: NavCategory[] }) {
  const shop =
    categories.length > 0
      ? categories.slice(0, 6).map((c) => ({ href: c.href, label: c.name }))
      : [{ href: '/products', label: 'All products' }];
  const cols = [
    { title: 'Shop', links: [...shop, { href: '/products?sort=newest', label: 'New arrivals' }] },
    {
      title: 'Help',
      links: [
        { href: '/track', label: 'Track your order' },
        { href: '/account/orders', label: 'Orders' },
        { href: '/account/returns', label: 'Returns & refunds' },
        { href: '/cart', label: 'Shopping bag' },
      ],
    },
    {
      title: 'Account',
      links: [
        { href: '/login', label: 'Sign in' },
        { href: '/register', label: 'Create account' },
        { href: '/wishlist', label: 'Wishlist' },
        { href: '/account/addresses', label: 'Saved addresses' },
      ],
    },
  ];
  return (
    <footer className="mt-16 bg-fg text-white">
      <div className="border-b border-white/10">
        <ul className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 py-6 text-sm sm:grid-cols-3 sm:px-6 lg:px-8">
          <li className="flex items-center gap-3">
            <Truck className="size-5 text-sun-400" aria-hidden />
            <span>
              <strong>Free shipping</strong> on orders above {FREE_SHIPPING_TEXT}
            </span>
          </li>
          <li className="flex items-center gap-3">
            <RotateCcw className="size-5 text-sun-400" aria-hidden />
            <span>
              <strong>{RETURN_DAYS}-day returns</strong> on delivered orders
            </span>
          </li>
          <li className="flex items-center gap-3">
            <ShieldCheck className="size-5 text-sun-400" aria-hidden />
            <span>
              <strong>Secure payments</strong> · UPI, cards, COD
            </span>
          </li>
        </ul>
      </div>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)] lg:px-8">
        <div className="max-w-sm">
          <VyraLogo withTagline className="text-3xl text-white" />
          <p className="mt-4 text-sm text-white/70">
            Fashion that moves with you. Fresh drops for men, women and kids, designed and shipped
            from India.
          </p>
          <h2 className="mt-6 text-xs font-bold uppercase tracking-widest text-white/90">
            Get early access
          </h2>
          <NewsletterForm tone="dark" source="footer" className="mt-3" />
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/90">{c.title}</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-white/70">
              {c.links.map((l) => (
                <li key={`${c.title}-${l.href}`}>
                  <Link href={l.href} className="hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>© {new Date().getFullYear()} VYRA. All prices inclusive of GST.</p>
          <p>Made in India · WEAR YOUR VIBE.</p>
        </div>
      </div>
    </footer>
  );
}
