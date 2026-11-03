import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((it, i) => (
          <li key={`${it.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3" aria-hidden />}
            {it.href && i < items.length - 1 ? (
              <Link href={it.href} className="hover:text-fg hover:underline">
                {it.label}
              </Link>
            ) : (
              <span
                aria-current={i === items.length - 1 ? 'page' : undefined}
                className="font-semibold text-fg"
              >
                {it.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
