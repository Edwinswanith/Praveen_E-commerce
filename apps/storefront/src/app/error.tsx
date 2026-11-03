'use client';

import * as React from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Button } from '@vyra/ui';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <h1 className="font-display text-xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        We couldn’t load this page. Please try again in a moment.
      </p>
      {error.digest && <p className="mt-1 text-xs text-subtle">Reference: {error.digest}</p>}
      <div className="mt-8 flex gap-3">
        <Button onClick={reset}>
          <RefreshCw aria-hidden /> Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
