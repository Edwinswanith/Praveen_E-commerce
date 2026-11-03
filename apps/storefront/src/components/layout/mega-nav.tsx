import Link from 'next/link';
import { cn } from '@vyra/ui';
import type { NavCategory } from '@/lib/categories';

const ACCENTS = ['text-brand-600', 'text-violet-600', 'text-teal-600', 'text-amber-600'];

/** Desktop mega-menu: opens on hover or keyboard focus (focus-within), no JS needed. */
export function MegaNav({ items }: { items: NavCategory[] }) {
  if (items.length === 0) return <div className="hidden flex-1 lg:block" />;
  return (
    <nav aria-label="Shop categories" className="hidden h-full lg:flex">
      <ul className="flex h-full items-stretch">
        {items.map((top, i) => (
          <li key={top.id} className="group/mega relative flex">
            <Link
              href={top.href}
              className="flex items-center border-b-[3px] border-transparent px-3 text-[13px] font-bold uppercase tracking-wider text-fg group-hover/mega:border-brand-500 group-focus-within/mega:border-brand-500"
            >
              {top.name}
            </Link>
            {top.children.length > 0 && (
              <div className="invisible absolute left-0 top-full z-50 pt-px opacity-0 transition-opacity duration-150 group-focus-within/mega:visible group-focus-within/mega:opacity-100 group-hover/mega:visible group-hover/mega:opacity-100">
                <div className="flex w-max max-w-[min(900px,80vw)] flex-wrap gap-x-10 gap-y-6 rounded-b-lg border border-t-0 border-border bg-bg px-8 py-6 shadow-pop">
                  {top.children.map((col) => (
                    <div key={col.id} className="min-w-40">
                      <Link
                        href={col.href}
                        className={cn(
                          'text-sm font-bold hover:underline',
                          ACCENTS[i % ACCENTS.length],
                        )}
                      >
                        {col.name}
                      </Link>
                      {col.children.length > 0 && (
                        <ul className="mt-2 space-y-1.5">
                          {col.children.map((leaf) => (
                            <li key={leaf.id}>
                              <Link
                                href={leaf.href}
                                className="text-sm text-muted hover:font-semibold hover:text-fg"
                              >
                                {leaf.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                  <div className="min-w-40">
                    <Link href={top.href} className="text-sm font-bold text-fg hover:underline">
                      View all {top.name}
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
