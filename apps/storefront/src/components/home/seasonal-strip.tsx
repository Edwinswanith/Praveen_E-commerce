import Link from 'next/link';

const COLLECTIONS = [
  {
    href: '/search?q=festive%20kurta',
    eyebrow: 'Festive',
    title: 'Wedding season sorted',
    cls: 'bg-brand-500 text-white',
  },
  {
    href: '/search?q=warm%20jacket',
    eyebrow: 'Winter',
    title: 'Jackets & layers',
    cls: 'bg-fg text-white',
  },
  {
    href: '/search?q=cotton%20everyday%20tee',
    eyebrow: 'Everyday',
    title: 'Easy cotton basics',
    cls: 'bg-teal-500 text-white',
  },
  {
    href: '/search?q=kids%20party%20wear',
    eyebrow: 'Little ones',
    title: 'Party-ready kids',
    cls: 'bg-sun-400 text-fg',
  },
];

export function SeasonalStrip() {
  return (
    <section aria-labelledby="collections" className="py-8">
      <h2
        id="collections"
        className="mb-4 font-display text-lg font-extrabold uppercase tracking-wide sm:text-xl"
      >
        Seasonal collections
      </h2>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 lg:grid-cols-4">
        {COLLECTIONS.map((c) => (
          <li key={c.href} className="w-[70%] shrink-0 snap-start sm:w-auto">
            <Link
              href={c.href}
              className={`group flex h-32 flex-col justify-between rounded-lg p-4 ${c.cls}`}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.25em] opacity-80">
                {c.eyebrow}
              </span>
              <span className="font-display text-lg font-extrabold leading-tight group-hover:underline">
                {c.title}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
