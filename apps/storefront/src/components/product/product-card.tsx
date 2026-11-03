import Link from 'next/link';
import type { ProductCardDto } from '@vyra/shared';
import { Badge, ColorDot, Price, cn } from '@vyra/ui';
import { ProductImage } from './product-image';
import { WishlistButton } from './wishlist-button';
import { QuickViewButton } from './quick-view-button';
import { RatingPill } from '../ui/stars';
import { CampaignTag } from '../campaign/campaign-badge';

const BADGE_TONE: Record<string, 'brand' | 'violet' | 'sun' | 'teal' | 'neutral'> = {
  new: 'violet',
  bestseller: 'sun',
  trending: 'brand',
  featured: 'teal',
};

export function ProductCard({
  product,
  priority = false,
  className,
}: {
  product: ProductCardDto;
  priority?: boolean;
  className?: string;
}) {
  const href = `/p/${product.slug}`;
  const colors = product.colors.slice(0, 5);
  return (
    <article className={cn('group relative flex flex-col', className)}>
      <div className="relative">
      <Link
        href={href}
        className="relative block aspect-[3/4] overflow-hidden rounded-md bg-surface-2"
        aria-label={`${product.brand} ${product.name}`}
      >
        <ProductImage
          src={product.imageUrl}
          alt={product.name}
          fill
          sizes="(min-width: 1280px) 20vw, (min-width: 768px) 30vw, 50vw"
          priority={priority}
          className={cn(
            'object-cover transition-opacity duration-300',
            product.hoverImageUrl && 'group-hover:opacity-0',
          )}
        />
        {product.hoverImageUrl && (
          <ProductImage
            src={product.hoverImageUrl}
            alt=""
            aria-hidden
            fill
            sizes="(min-width: 1280px) 20vw, (min-width: 768px) 30vw, 50vw"
            className="object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          />
        )}
        {product.badges.length > 0 && (
          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {product.badges.slice(0, 2).map((b) => (
              <Badge key={b} tone={BADGE_TONE[b.toLowerCase().replace(/[^a-z]/g, '')] ?? 'neutral'}>
                {b}
              </Badge>
            ))}
          </div>
        )}
        {product.rating !== null && product.reviewCount > 0 && (
          <RatingPill
            rating={product.rating}
            count={product.reviewCount}
            className="absolute bottom-2 left-2 bg-bg/90"
          />
        )}
        {!product.inStock && (
          <div className="absolute inset-x-0 bottom-0 bg-bg/85 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted">
            Out of stock
          </div>
        )}
      </Link>
      <WishlistButton
        productId={product.id}
        productName={product.name}
        className="absolute right-0 top-0"
      />
      <QuickViewButton
        productId={product.id}
        slug={product.slug}
        name={`${product.brand} ${product.name}`}
        className={product.inStock ? undefined : 'max-lg:bottom-7 lg:bottom-9'}
      />
      </div>
      <div className="mt-2 flex flex-col gap-0.5 px-0.5">
        <p className="truncate text-sm font-bold text-fg">{product.brand}</p>
        <Link href={href} className="truncate text-sm text-muted hover:text-fg">
          {product.name}
        </Link>
        <Price price={product.minPrice} mrp={product.minMrp} size="sm" className="mt-0.5" />
        {product.campaign && <CampaignTag campaign={product.campaign} className="mt-0.5" />}
        {colors.length > 1 && (
          <div
            className="mt-1 flex items-center gap-1"
            aria-label={`${product.colors.length} colours`}
          >
            {colors.map((c) => (
              <ColorDot key={c.name} hex={c.hex} name={c.name} />
            ))}
            {product.colors.length > colors.length && (
              <span className="text-[11px] text-muted">
                +{product.colors.length - colors.length}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
