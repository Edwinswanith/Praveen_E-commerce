import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
      <p className="text-sm font-semibold text-muted">404</p>
      <h1 className="text-xl font-bold">Page not found</h1>
      <Link href="/" className="text-sm font-semibold text-brand-600 hover:underline">Back to dashboard</Link>
    </div>
  );
}
