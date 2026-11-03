import { expect, test } from '@playwright/test';
import { addFirstAvailableToBag, ADMIN, fillAddress, freshPhone, inStockProductSlug, STORE, staffLogin, API } from './helpers';

test('guest prepaid purchase with the TEST MODE payment and server-side verification', async ({ page, request }) => {
  await addFirstAvailableToBag(page, await inStockProductSlug(request));
  await page.goto(`${STORE}/checkout`);
  await page.fill('#guest-email', `prepaid-${Date.now()}@demo.vyra.local`);
  await fillAddress(page, freshPhone());
  await expect(page.getByText(/by paying online/i).first()).toBeVisible();
  await page.getByRole('button', { name: /^Pay ₹/ }).click();
  await expect(page.getByText('TEST MODE').first()).toBeVisible();
  const verify = page.waitForResponse((r) => r.url().includes('/payments/verify'));
  await page.getByRole('button', { name: /simulate success/i }).click();
  const order = (await (await verify).json()).data;
  expect(order).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'CAPTURED' });
  expect(order.prepaidDiscount).toBeGreaterThan(0);
  await page.waitForURL(/confirmation/);
});

test('scanner identifies a barcode without changing stock; explicit receive writes the ledger', async ({ page, request }) => {
  await staffLogin(page, 'inventory@vyra.local');
  const login = await request.post(`${API}/api/v1/admin/auth/login`, { headers: { 'X-Requested-With': 'vyra' }, data: { email: 'inventory@vyra.local', password: process.env.SEED_STAFF_PASSWORD ?? 'VyraStaff@2026' } });
  expect(login.ok()).toBeTruthy();
  const inv = (await (await request.get(`${API}/api/v1/admin/inventory?pageSize=5&status=IN_STOCK`)).json()).data[0];
  await page.goto(`${ADMIN}/scanner`);
  await page.getByRole('tab', { name: /receive/i }).or(page.getByRole('radio', { name: /receive/i })).or(page.getByRole('button', { name: /^receive/i })).first().click();
  const input = page.getByPlaceholder('Scan or type barcode / SKU');
  await input.fill(inv.barcode);
  await input.press('Enter');
  await expect(page.getByText('Not saved yet')).toBeVisible();
  const afterScan = (await (await request.get(`${API}/api/v1/admin/inventory?q=${inv.sku}`)).json()).data[0];
  expect(afterScan.onHand).toBe(inv.onHand);
  await page.getByRole('button', { name: /confirm stock in/i }).click();
  await expect.poll(async () => (await (await request.get(`${API}/api/v1/admin/inventory?q=${inv.sku}`)).json()).data[0].onHand).toBe(inv.onHand + 1);
  const recon = (await (await request.get(`${API}/api/v1/admin/inventory/reconcile`)).json()).data;
  expect(recon.consistent).toBe(true);
});

test('@mobile storefront home, PDP and search fit a phone screen', async ({ page }) => {
  for (const path of ['/', '/search?q=black%20tee%20under%201000', '/c/women']) {
    await page.goto(`${STORE}${path}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, `horizontal overflow on ${path}`).toBe(false);
  }
  const missing = await page.goto(`${STORE}/p/this-product-does-not-exist`);
  expect(missing?.status()).toBe(404);
});

test('@mobile scanning a garment tag QR opens the product with that colour and size selected', async ({ page, request }) => {
  const list = (await (await request.get(`${API}/api/v1/products?inStock=true&pageSize=10`)).json()).data.items as { slug: string }[];
  const pdp = (await (await request.get(`${API}/api/v1/products/${list[0]!.slug}`)).json()).data;
  const v = pdp.variants.find((x: { inStock: boolean }) => x.inStock);
  await page.goto(`${STORE}/s/${v.sku}`);
  await expect(page).toHaveURL(new RegExp(`/p/${pdp.slug}\\?variant=${v.id}`));
  await expect(page.locator(`[aria-pressed="true"], [aria-checked="true"]`).filter({ hasText: new RegExp(`^${v.size}$`) }).first()).toBeVisible();
  const unknown = await page.goto(`${STORE}/s/VY-XXX-99999-NOPE-M`);
  expect(unknown?.url()).toContain('/search?q=');
});
