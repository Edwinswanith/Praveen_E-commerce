import { expect, test } from '@playwright/test';
import { addFirstAvailableToBag, API, STORE } from './helpers';

type Campaign = { slug: string; phase: string; claim: { upToPercent: number | null } };

/** Runs against the seeded live "Festive Edit Sale"; skips if no sale is live. */
test('festival sale: banner claim, landing page, PDP and bag all agree with the server', async ({ page, request }) => {
  const current = (await (await request.get(`${API}/api/v1/campaigns/current`)).json()).data as Campaign[];
  const live = current.find((c) => c.phase === 'LIVE');
  test.skip(!live, 'no live campaign in this database');

  // Home banner: the "Up to X%" is exactly the server's live claim (or no % at all).
  await page.goto(STORE);
  const banner = page.getByTestId('sale-banner').first();
  await expect(banner).toBeVisible();
  if (live!.claim.upToPercent == null) await expect(banner.getByTestId('sale-claim')).toHaveCount(0);
  else await expect(banner.getByTestId('sale-claim')).toContainText(`${live!.claim.upToPercent}%`);

  // Landing page lists products tagged with this sale.
  await page.goto(`${STORE}/sale/${live!.slug}`);
  await expect(page.getByTestId('campaign-tag').first()).toBeVisible();

  // PDP of a sale product: sale price below the regular price, shown as plain text (MRP is the only strike-through).
  const products = (await (await request.get(`${API}/api/v1/campaigns/${live!.slug}/products?limit=10`)).json()).data as { slug: string; inStock: boolean }[];
  const slug = products.find((p) => p.inStock)!.slug;
  const detail = (await (await request.get(`${API}/api/v1/products/${slug}`)).json()).data as { variants: { price: number; basePrice: number; campaign: unknown; inStock: boolean }[] };
  const deal = detail.variants.find((v) => v.campaign && v.inStock)!;
  expect(deal.price).toBeLessThan(deal.basePrice);
  await addFirstAvailableToBag(page, slug);
  await expect(page.getByTestId('regular-price')).toBeVisible();

  // Bag: sale savings come from the server and the total matches the server's quote.
  await page.goto(`${STORE}/cart`);
  const cart = (await (await page.request.get(`${API}/api/v1/cart`)).json()).data as { totals: { campaignSavings: number; grandTotal: number } };
  if (cart.totals.campaignSavings > 0) await expect(page.getByTestId('sale-savings').first()).toBeVisible();
  await expect(page.getByTestId('grand-total').first()).toContainText(cart.totals.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
});

test('unknown sale pages are 404, never a fake sale', async ({ page }) => {
  const r = await page.goto(`${STORE}/sale/no-such-sale-xyz`);
  expect(r?.status()).toBe(404);
});
