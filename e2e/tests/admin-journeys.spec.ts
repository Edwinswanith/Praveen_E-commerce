import { expect, test, type Page } from '@playwright/test';
import { ADMIN, API, H, STAFF_PASSWORD } from './helpers';

/**
 * Admin dashboard verification: every screen loads without console errors or
 * horizontal overflow, and the main mutations work through the UI with their
 * effect checked via the API. One staff login is shared (login is rate limited).
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${String(e)}`));
  page.on('dialog', (d) => void d.accept());
  await page.goto(`${ADMIN}/login`);
  await page.fill('#email', 'owner@vyra.local');
  await page.fill('#password', STAFF_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
});
test.afterAll(async () => page?.close());

const api = async <T>(path: string): Promise<T> => {
  const r = await page.request.get(`${API}/api/v1/admin${path}`);
  expect(r.ok(), `${path} ${r.status()}`).toBeTruthy();
  return (await r.json()).data as T;
};

test('every admin screen loads with no console errors and no horizontal overflow', async () => {
  const product = (await api<{ id: string }[]>('/products?pageSize=1'))[0]!;
  const order = (await api<{ id: string }[]>('/orders?pageSize=1'))[0]!;
  const customer = (await api<{ id: string }[]>('/customers?pageSize=1'))[0]!;
  const campaign = (await api<{ id: string }[]>('/campaigns'))[0]!;
  const po = (await api<{ id: string }[]>('/purchase-orders?pageSize=1'))[0];
  const screens = [
    '/', '/products', '/products/new', '/products/import', `/products/${product.id}`, '/categories', '/inventory', '/inventory/movements',
    '/inventory/purchase-orders', '/inventory/purchase-orders/new', ...(po ? [`/inventory/purchase-orders/${po.id}`] : []), '/inventory/suppliers',
    '/barcodes', '/scanner', '/orders', `/orders/${order.id}`, '/returns', '/cod', '/customers', `/customers/${customer.id}`,
    '/campaigns', '/campaigns/new', `/campaigns/${campaign.id}`, `/campaigns/${campaign.id}/edit`, '/promotions', '/reviews', '/newsletter',
    '/analytics', '/analytics/conversion', '/settings',
  ];
  const overflow: string[] = [];
  for (const s of screens) {
    const r = await page.goto(`${ADMIN}${s}`);
    expect(r?.status(), s).toBeLessThan(400);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main')).toBeVisible();
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (ov > 1) overflow.push(`${s} +${ov}px`);
  }
  expect(overflow).toEqual([]);
  expect(errors).toEqual([]);
});

test('categories: create, edit and delete through the UI', async () => {
  // Remove leftovers from an earlier interrupted run.
  for (const c of await api<{ id: string; slug: string }[]>('/categories')) {
    if (c.slug.startsWith('e2e-cat-')) await page.request.delete(`${API}/api/v1/admin/categories/${c.id}`, { headers: H });
  }
  const tag = Date.now().toString(36);
  const slug = `e2e-cat-${tag}`;
  const name = `E2E Category ${tag}`;
  await page.goto(`${ADMIN}/categories`);
  await page.getByRole('button', { name: /new category/i }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill(name);
  await dlg.getByLabel('Slug').fill(slug);
  await dlg.getByLabel('Code').fill('EZE');
  await dlg.getByRole('button', { name: /save|create/i }).click();
  await expect.poll(async () => (await api<{ slug: string }[]>('/categories')).some((c) => c.slug === slug)).toBe(true);
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name').fill(`${name} Renamed`);
  await page.getByRole('dialog').getByRole('button', { name: /save/i }).click();
  await expect.poll(async () => (await api<{ slug: string; name: string }[]>('/categories')).find((c) => c.slug === slug)?.name).toBe(`${name} Renamed`);
  await page.getByRole('button', { name: `Delete ${name} Renamed`, exact: true }).click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: /^delete$/i }).click();
  await expect.poll(async () => (await api<{ slug: string }[]>('/categories')).some((c) => c.slug === slug)).toBe(false);
});

test('AI studio photo requests /api/v1/admin/products/:id/images/generate (no doubled prefix)', async () => {
  const product = (await api<{ id: string }[]>('/products?pageSize=1'))[0]!;
  const seen: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/images/generate')) seen.push(new URL(r.url()).pathname); });
  // Intercepted: proves the request the browser makes without paying for a Gemini generation.
  await page.route('**/images/generate', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  await page.goto(`${ADMIN}/products/${product.id}`);
  await page.getByRole('button', { name: /ai studio photo/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: /generate/i }).click();
  await expect.poll(() => seen.length).toBe(1);
  expect(seen[0]).toBe(`/api/v1/admin/products/${product.id}/images/generate`);
  await page.unroute('**/images/generate');
});

test('reviews: hide with a reason, then restore', async () => {
  const reviews = await api<{ id: string; title: string | null; isPublished: boolean }[]>('/reviews?status=published&pageSize=1');
  test.skip(!reviews.length, 'no published reviews in this database');
  const r = reviews[0]!;
  await page.goto(`${ADMIN}/reviews`);
  const row = page.locator('tr', { hasText: r.title ?? '' }).first();
  await row.getByRole('button', { name: /^hide review/i }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('E2E moderation check');
  await page.getByRole('dialog').getByRole('button', { name: /hide/i }).click();
  await expect.poll(async () => (await api<{ id: string; isPublished: boolean }[]>('/reviews?pageSize=100')).find((x) => x.id === r.id)?.isPublished).toBe(false);
  await page.locator('tr', { hasText: r.title ?? '' }).first().getByRole('button', { name: /^restore review/i }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('E2E moderation check done');
  await page.getByRole('dialog').getByRole('button', { name: /restore/i }).click();
  await expect.poll(async () => (await api<{ id: string; isPublished: boolean }[]>('/reviews?pageSize=100')).find((x) => x.id === r.id)?.isPublished).toBe(true);
});

test('inventory ledger check reports consistent; newsletter export downloads a CSV', async () => {
  await page.goto(`${ADMIN}/inventory`);
  await page.getByRole('button', { name: /run check/i }).click();
  await expect(page.getByText(/consistent/i).first()).toBeVisible();
  expect((await api<{ consistent: boolean }>('/inventory/reconcile')).consistent).toBe(true);
  await page.goto(`${ADMIN}/newsletter`);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /export confirmed/i }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
});

test('customer support notes save from the customer page', async () => {
  const customer = (await api<{ id: string }[]>('/customers?pageSize=1'))[0]!;
  const before = (await api<{ notes: string | null }>(`/customers/${customer.id}`)).notes;
  await page.goto(`${ADMIN}/customers/${customer.id}`);
  await page.getByRole('button', { name: /^edit$/i }).click();
  await page.getByLabel('Notes').fill('E2E: prefers WhatsApp');
  await page.getByRole('button', { name: /save notes/i }).click();
  await expect.poll(async () => (await api<{ notes: string | null }>(`/customers/${customer.id}`)).notes).toBe('E2E: prefers WhatsApp');
  // Restore the original notes.
  const r = await page.request.post(`${API}/api/v1/admin/customers/${customer.id}/notes`, { headers: H, data: { notes: before ?? '' } });
  expect(r.ok()).toBeTruthy();
  expect(errors).toEqual([]);
});
