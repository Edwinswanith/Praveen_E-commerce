import Link from 'next/link';
import { Button } from '@vyra/ui';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <p className="font-display text-7xl font-extrabold text-brand-500">404</p>
      <h1 className="mt-4 font-display text-xl font-bold">This page took a style detour</h1>
      <p className="mt-2 text-sm text-muted">
        The page you’re looking for doesn’t exist or the product is no longer available.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild>
          <Link href="/">Go home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/products">Browse products</Link>
        </Button>
      </div>
    </div>
  );
}
