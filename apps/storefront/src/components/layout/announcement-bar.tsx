import Link from 'next/link';
import { FREE_SHIPPING_TEXT, RETURN_DAYS } from '@/lib/store-promises';

export function AnnouncementBar() {
  return (
    <div className="bg-fg text-white">
      <p className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-2 text-center text-[11px] font-medium tracking-wide sm:text-xs">
        <span>Free shipping on orders above {FREE_SHIPPING_TEXT}</span>
        <span aria-hidden className="text-white/40">
          ·
        </span>
        <span className="hidden sm:inline">Easy {RETURN_DAYS}-day returns</span>
        <span aria-hidden className="hidden text-white/40 sm:inline">
          ·
        </span>
        <Link
          href="/products?sort=newest"
          className="font-semibold text-sun-400 underline-offset-2 hover:underline"
        >
          New drops weekly
        </Link>
      </p>
    </div>
  );
}
