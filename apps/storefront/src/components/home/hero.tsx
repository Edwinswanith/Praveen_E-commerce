import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/**
 * Editorial campaign banners built from type + colour blocks (no stock photos).
 * One feature tile and two supporting tiles; on mobile they become a snap carousel.
 */
export function Hero() {
  return (
    <section aria-label="Featured campaigns" className="pt-4 sm:pt-6">
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0 lg:grid lg:grid-cols-3 lg:grid-rows-2 lg:gap-4 lg:overflow-visible">
        {/* Feature tile */}
        <Link
          href="/products?sort=newest"
          className="group relative flex aspect-[4/5] w-[86%] shrink-0 snap-center flex-col justify-between overflow-hidden rounded-xl bg-fg p-6 text-white sm:aspect-[16/10] sm:w-full lg:col-span-2 lg:row-span-2 lg:aspect-auto lg:min-h-[460px] lg:p-10"
        >
          <span
            aria-hidden
            className="absolute -right-16 -top-16 size-72 rounded-full bg-brand-500 transition-transform duration-500 group-hover:scale-105 lg:size-[420px]"
          />
          <span
            aria-hidden
            className="absolute -bottom-10 right-24 size-40 rotate-12 rounded-3xl bg-violet-500 lg:size-56"
          />
          <span
            aria-hidden
            className="absolute bottom-10 right-8 size-16 rounded-full bg-sun-400 lg:size-24"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-6 left-4 select-none font-display text-[120px] font-extrabold leading-none text-white/[0.06] lg:text-[220px]"
          >
            VIBE
          </span>
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-sun-400">
              The Winter ’26 Edit
            </p>
            <h2 className="mt-3 max-w-md font-display text-3xl font-extrabold leading-[1.05] sm:text-4xl lg:text-5xl">
              Layer up.
              <br />
              Stand out.
            </h2>
            <p className="mt-3 max-w-xs text-sm text-white/75">
              Oversized fits, rich textures and colour that refuses to blend in.
            </p>
          </div>
          <span className="relative inline-flex w-fit items-center gap-2 rounded-md bg-white px-5 py-3 text-xs font-bold uppercase tracking-wider text-fg transition-colors group-hover:bg-sun-400">
            Shop new arrivals <ArrowRight className="size-4" aria-hidden />
          </span>
        </Link>

        <Link
          href="/search?q=denim"
          className="group relative flex aspect-[4/5] w-[86%] shrink-0 snap-center flex-col justify-between overflow-hidden rounded-xl bg-violet-500 p-6 text-white sm:aspect-[16/10] sm:w-full lg:aspect-auto"
        >
          <span
            aria-hidden
            className="absolute -right-8 top-6 h-[140%] w-16 rotate-[20deg] bg-white/10"
          />
          <span
            aria-hidden
            className="absolute -right-0 top-6 h-[140%] w-6 rotate-[20deg] bg-sun-400/80"
          />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/80">
              Street Denim
            </p>
            <h2 className="mt-2 font-display text-2xl font-extrabold leading-tight sm:text-3xl">
              Blue, but
              <br />
              make it bold.
            </h2>
          </div>
          <span className="relative inline-flex items-center gap-1.5 text-sm font-bold underline-offset-4 group-hover:underline">
            Explore denim <ArrowRight className="size-4" aria-hidden />
          </span>
        </Link>

        <Link
          href="/products?sort=discount"
          className="group relative flex aspect-[4/5] w-[86%] shrink-0 snap-center flex-col justify-between overflow-hidden rounded-xl bg-sun-400 p-6 text-fg sm:aspect-[16/10] sm:w-full lg:aspect-auto"
        >
          <span
            aria-hidden
            className="absolute -bottom-12 -right-12 size-48 rounded-full border-[28px] border-brand-500"
          />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-fg/70">
              Price Drop
            </p>
            <h2 className="mt-2 font-display text-2xl font-extrabold leading-tight sm:text-3xl">
              Up to
              <br />
              <span className="text-brand-600">60% off</span>
            </h2>
            <p className="mt-1 text-xs font-medium text-fg/70">
              On selected styles. While stocks last.
            </p>
          </div>
          <span className="relative inline-flex items-center gap-1.5 text-sm font-bold underline-offset-4 group-hover:underline">
            Shop the drop <ArrowRight className="size-4" aria-hidden />
          </span>
        </Link>
      </div>
    </section>
  );
}
