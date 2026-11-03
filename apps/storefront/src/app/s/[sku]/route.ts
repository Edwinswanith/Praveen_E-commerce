import { NextResponse, type NextRequest } from 'next/server';

/**
 * QR tag landing: /s/<SKU> → the product page with that colour and size
 * preselected. Printed on garment tags, so it must stay stable forever.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const api = process.env.API_URL ?? 'http://localhost:4000';
  const res = await fetch(`${api}/api/v1/products/by-sku/${encodeURIComponent(sku)}`, { next: { revalidate: 300 } }).catch(() => null);
  if (!res?.ok) {
    // Unknown or retired SKU: still land somewhere useful instead of an error page.
    return NextResponse.redirect(new URL(`/search?q=${encodeURIComponent(sku)}`, req.url), 302);
  }
  const { data } = (await res.json()) as { data: { slug: string; variantId: string } };
  const target = new URL(`/p/${encodeURIComponent(data.slug)}`, req.url);
  target.searchParams.set('variant', data.variantId);
  target.searchParams.set('utm_source', 'tag');
  target.searchParams.set('utm_medium', 'qr');
  return NextResponse.redirect(target, 302);
}
