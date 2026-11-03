import type { ProductDetailDto } from '@vyra/shared';

function labelize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function Specs({ product }: { product: ProductDetailDto }) {
  const entries = Object.entries(product.attributes).filter(([k, v]) => v && k !== 'care');
  const care = product.attributes.care;
  return (
    <section aria-labelledby="details-heading" className="grid gap-8 py-8 md:grid-cols-2">
      <div>
        <h2
          id="details-heading"
          className="font-display text-lg font-extrabold uppercase tracking-wide"
        >
          Product details
        </h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-fg/90">
          {product.description}
        </p>
        {care && (
          <>
            <h3 className="mt-5 text-sm font-bold">Care</h3>
            <p className="mt-1 text-sm text-muted">{care}</p>
          </>
        )}
      </div>
      {entries.length > 0 && (
        <div>
          <h2 className="font-display text-lg font-extrabold uppercase tracking-wide">
            Specifications
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6">
            {entries.map(([k, v]) => (
              <div key={k} className="border-b border-border py-3">
                <dt className="text-xs text-muted">{labelize(k)}</dt>
                <dd className="mt-0.5 text-sm font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
