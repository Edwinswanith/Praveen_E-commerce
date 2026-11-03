import Image, { type ImageProps } from 'next/image';
import { ImageOff } from 'lucide-react';
import { cn } from '@vyra/ui';
import { shouldSkipOptimization } from '@/lib/media';

/** next/image wrapper: API `/media/...` and SVG seed images bypass the optimiser. Renders a neutral placeholder when src is missing. */
export function ProductImage({
  src,
  alt,
  className,
  ...rest
}: Omit<ImageProps, 'src'> & { src: string | null | undefined }) {
  if (!src) {
    return (
      <div
        className={cn(
          'flex size-full items-center justify-center bg-surface-2 text-subtle',
          className,
        )}
        role="img"
        aria-label={alt || 'No image'}
      >
        <ImageOff className="size-6" aria-hidden />
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      unoptimized={shouldSkipOptimization(src)}
      className={className}
      {...rest}
    />
  );
}
