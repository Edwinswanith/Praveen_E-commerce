'use client';

import * as React from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import * as Checkbox from '@radix-ui/react-checkbox';
import * as Slider from '@radix-ui/react-slider';
import { Check, ChevronDown, Star } from 'lucide-react';
import type { ProductFacets } from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { ColorDot, cn } from '@vyra/ui';
import { splitList, toggleListValue, withParam } from '@/lib/listing-params';
import { useListingNav } from './listing-shell';

interface Option {
  value: string;
  label: string;
  count?: number;
  hex?: string | null;
}

function CheckList({
  name,
  paramKey,
  options,
  single = false,
}: {
  name: string;
  paramKey: string;
  options: Option[];
  single?: boolean;
}) {
  const { params, navigate } = useListingNav();
  const [expanded, setExpanded] = React.useState(false);
  const selected = splitList(params.get(paramKey));
  const visible = expanded ? options : options.slice(0, 8);
  return (
    <fieldset>
      <legend className="sr-only">{name}</legend>
      <ul className="space-y-1">
        {visible.map((o) => {
          const checked = selected.includes(o.value);
          const id = `f-${paramKey}-${o.value}`.replace(/[^a-zA-Z0-9_-]/g, '_');
          return (
            <li key={o.value} className="flex items-center gap-2.5 py-1">
              <Checkbox.Root
                id={id}
                checked={checked}
                onCheckedChange={() =>
                  navigate(
                    single
                      ? withParam(params, paramKey, checked ? null : o.value)
                      : toggleListValue(params, paramKey, o.value),
                  )
                }
                className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong data-[state=checked]:border-brand-500 data-[state=checked]:bg-brand-500"
              >
                <Checkbox.Indicator>
                  <Check className="size-3 text-white" strokeWidth={3} aria-hidden />
                </Checkbox.Indicator>
              </Checkbox.Root>
              <label
                htmlFor={id}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm"
              >
                {o.hex !== undefined && (
                  <ColorDot hex={o.hex} name={o.label} className="size-3.5" />
                )}
                <span className={cn('truncate', checked && 'font-semibold')}>{o.label}</span>
                {o.count !== undefined && (
                  <span className="ml-auto text-xs text-subtle">({o.count})</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      {options.length > 8 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-xs font-semibold text-brand-600 hover:underline"
        >
          {expanded ? 'Show less' : `+ ${options.length - 8} more`}
        </button>
      )}
    </fieldset>
  );
}

function PriceRange({ bounds }: { bounds: { min: number; max: number } }) {
  const { params, navigate } = useListingNav();
  const curMin = Number(params.get('minPrice') ?? NaN);
  const curMax = Number(params.get('maxPrice') ?? NaN);
  const lo = Math.floor(Math.min(bounds.min, Number.isFinite(curMin) ? curMin : bounds.min));
  const hi = Math.ceil(Math.max(bounds.max, Number.isFinite(curMax) ? curMax : bounds.max));
  const [value, setValue] = React.useState<[number, number]>([
    Number.isFinite(curMin) ? curMin : lo,
    Number.isFinite(curMax) ? curMax : hi,
  ]);
  React.useEffect(() => {
    setValue([Number.isFinite(curMin) ? curMin : lo, Number.isFinite(curMax) ? curMax : hi]);
  }, [curMin, curMax, lo, hi]);
  if (hi <= lo) return <p className="text-sm text-muted">{formatINR(lo)}</p>;
  const step = hi - lo > 2000 ? 100 : 50;
  const commit = ([a, b]: number[]) => {
    const next = new URLSearchParams(params);
    if (a !== undefined && a > lo) next.set('minPrice', String(a));
    else next.delete('minPrice');
    if (b !== undefined && b < hi) next.set('maxPrice', String(b));
    else next.delete('maxPrice');
    next.delete('page');
    navigate(next.toString());
  };
  return (
    <div className="px-1 pt-2">
      <Slider.Root
        min={lo}
        max={hi}
        step={step}
        minStepsBetweenThumbs={1}
        value={value}
        onValueChange={(v) => setValue([v[0] ?? lo, v[1] ?? hi])}
        onValueCommit={commit}
        className="relative flex h-5 touch-none select-none items-center"
      >
        <Slider.Track className="relative h-1 grow rounded-full bg-border">
          <Slider.Range className="absolute h-full rounded-full bg-brand-500" />
        </Slider.Track>
        <Slider.Thumb
          aria-label="Minimum price"
          className="block size-4 rounded-full border-2 border-brand-500 bg-bg shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        />
        <Slider.Thumb
          aria-label="Maximum price"
          className="block size-4 rounded-full border-2 border-brand-500 bg-bg shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        />
      </Slider.Root>
      <p className="mt-2 flex justify-between text-xs font-semibold tabular-nums">
        <span>{formatINR(value[0])}</span>
        <span>
          {formatINR(value[1])}
          {value[1] >= hi ? '+' : ''}
        </span>
      </p>
    </div>
  );
}

function RatingFilter() {
  const { params, navigate } = useListingNav();
  const cur = params.get('minRating');
  return (
    <div role="radiogroup" aria-label="Customer rating" className="space-y-1">
      {['4', '3'].map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={cur === r}
          onClick={() => navigate(withParam(params, 'minRating', cur === r ? null : r))}
          className={cn(
            'flex w-full items-center gap-2 rounded-sm py-1 text-left text-sm',
            cur === r && 'font-semibold text-brand-600',
          )}
        >
          <span
            className={cn(
              'flex size-4 items-center justify-center rounded-full border',
              cur === r ? 'border-brand-500' : 'border-border-strong',
            )}
          >
            {cur === r && <span className="size-2 rounded-full bg-brand-500" />}
          </span>
          {r}
          <Star className="size-3.5 fill-sun-400 text-sun-400" aria-hidden /> & above
        </button>
      ))}
    </div>
  );
}

function AvailabilityFilter() {
  const { params, navigate } = useListingNav();
  const on = params.get('inStock') === 'true';
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-1 text-sm">
      <Checkbox.Root
        checked={on}
        onCheckedChange={() => navigate(withParam(params, 'inStock', on ? null : 'true'))}
        className="flex size-4 items-center justify-center rounded-[4px] border border-border-strong data-[state=checked]:border-brand-500 data-[state=checked]:bg-brand-500"
      >
        <Checkbox.Indicator>
          <Check className="size-3 text-white" strokeWidth={3} aria-hidden />
        </Checkbox.Indicator>
      </Checkbox.Root>
      Exclude out of stock
    </label>
  );
}

export function FilterPanel({
  facets,
  showCategory = true,
}: {
  facets: ProductFacets;
  showCategory?: boolean;
}) {
  const sections: { id: string; title: string; node: React.ReactNode; show: boolean }[] = [
    {
      id: 'category',
      title: 'Categories',
      show: showCategory && facets.categories.length > 0,
      node: (
        <CheckList
          name="Categories"
          paramKey="category"
          single
          options={facets.categories.map((c) => ({ value: c.slug, label: c.name, count: c.count }))}
        />
      ),
    },
    {
      id: 'price',
      title: 'Price',
      show: facets.price.max > 0,
      node: <PriceRange bounds={facets.price} />,
    },
    {
      id: 'sizes',
      title: 'Size',
      show: facets.sizes.length > 0,
      node: (
        <CheckList
          name="Size"
          paramKey="sizes"
          options={facets.sizes.map((s) => ({ value: s.value, label: s.value, count: s.count }))}
        />
      ),
    },
    {
      id: 'colors',
      title: 'Colour',
      show: facets.colors.length > 0,
      node: (
        <CheckList
          name="Colour"
          paramKey="colors"
          options={facets.colors.map((c) => ({
            value: c.value,
            label: c.value,
            count: c.count,
            hex: c.hex,
          }))}
        />
      ),
    },
    {
      id: 'brands',
      title: 'Brand',
      show: facets.brands.length > 0,
      node: (
        <CheckList
          name="Brand"
          paramKey="brands"
          options={facets.brands.map((b) => ({ value: b.value, label: b.value, count: b.count }))}
        />
      ),
    },
    {
      id: 'fabric',
      title: 'Fabric',
      show: facets.fabrics.length > 0,
      node: (
        <CheckList
          name="Fabric"
          paramKey="fabric"
          options={facets.fabrics.map((b) => ({ value: b.value, label: b.value, count: b.count }))}
        />
      ),
    },
    {
      id: 'fit',
      title: 'Fit',
      show: facets.fits.length > 0,
      node: (
        <CheckList
          name="Fit"
          paramKey="fit"
          options={facets.fits.map((b) => ({ value: b.value, label: b.value, count: b.count }))}
        />
      ),
    },
    {
      id: 'occasion',
      title: 'Occasion',
      show: facets.occasions.length > 0,
      node: (
        <CheckList
          name="Occasion"
          paramKey="occasion"
          options={facets.occasions.map((b) => ({
            value: b.value,
            label: b.value,
            count: b.count,
          }))}
        />
      ),
    },
    { id: 'availability', title: 'Availability', show: true, node: <AvailabilityFilter /> },
    { id: 'rating', title: 'Customer rating', show: true, node: <RatingFilter /> },
  ];
  const visible = sections.filter((s) => s.show);
  return (
    <Accordion.Root
      type="multiple"
      defaultValue={visible.map((s) => s.id)}
      className="divide-y divide-border"
    >
      {visible.map((s) => (
        <Accordion.Item key={s.id} value={s.id} className="py-1">
          <Accordion.Header>
            <Accordion.Trigger className="group flex w-full items-center justify-between py-3 text-xs font-bold uppercase tracking-wider">
              {s.title}
              <ChevronDown
                className="size-4 text-muted transition-transform group-data-[state=open]:rotate-180"
                aria-hidden
              />
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content className="pb-3">{s.node}</Accordion.Content>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}
