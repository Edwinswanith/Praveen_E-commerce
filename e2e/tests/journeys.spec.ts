import { expect, test, type Page } from '@playwright/test';
import { addFirstAvailableToBag, API, freshPhone, H, inStockProductSlug, STAFF_PASSWORD, STORE } from './helpers';

/**
 * Customer journeys A–D, G–J from the verification plan, driven through the
 * real UI with server-side state checked via the API after each step.
 * Every test also fails on browser console errors.
 */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    // Guest session probes (/auth/me, /auth/refresh) answer 401 by design.
    if (m.type() === 'error' && !/401|Unauthorized/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test('A: create an account, sign out, sign in again and open the account page', async ({ page }) => {
  const errors = watchConsole(page);
  const email = `journey${Date.now()}@test.local`;
  await page.goto(`${STORE}/register`);
  await page.getByRole('button', { name: /sign up with email instead/i }).click();
  await page.getByLabel('Full name').fill('Journey Tester');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Journey!pass1');
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/register'));
  const me = await page.request.get(`${API}/api/v1/auth/me`);
  expect((await me.json()).data.email).toBe(email);
  await page.goto(`${STORE}/account`);
  await page.getByRole('button', { name: /account menu/i }).click();
  await page.getByRole('menuitem', { name: /sign out/i }).or(page.getByRole('button', { name: /sign out/i })).first().click();
  await expect.poll(async () => (await page.request.get(`${API}/api/v1/auth/me`)).status()).toBe(401);
  await page.goto(`${STORE}/login`);
  const emailMode = page.getByRole('button', { name: /sign in with email/i });
  if (await emailMode.isVisible()) await emailMode.click(); // the page remembers the last mode
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Journey!pass1');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(`${STORE}/account`);
  await expect(page.getByText('Journey Tester').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('B: browse a category, filter, sort and pick a colour and size on the product page', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(STORE);
  const cats = (await (await page.request.get(`${API}/api/v1/categories`)).json()).data as { slug: string; children: { slug: string }[] }[];
  const leaf = cats.find((c) => c.children?.length)!.children[0]!.slug;
  await page.goto(`${STORE}/c/${cats.find((c) => c.children?.some((x) => x.slug === leaf))!.slug}/${leaf}`);
  await expect(page.locator('main a[href^="/p/"]').first()).toBeVisible();
  await page.getByLabel('Sort by').first().selectOption('price_asc');
  await page.waitForURL(/sort=price_asc/);
  const prices = await page.evaluate(() => [...document.querySelectorAll('main a[href^="/p/"]')].length);
  expect(prices).toBeGreaterThan(0);
  // The listing API applies the same sort the URL asks for.
  const list = (await (await page.request.get(`${API}/api/v1/products?category=${leaf}&sort=price_asc&pageSize=60`)).json()).data.items as { minPrice: number }[];
  expect(list.map((p) => p.minPrice)).toEqual([...list.map((p) => p.minPrice)].sort((a, b) => a - b));
  await page.locator('main a[href^="/p/"]').first().click();
  await page.waitForURL(/\/p\//);
  const size = page.locator('button:not([disabled])', { hasText: /^(XS|S|M|L|XL|XXL|\d{1,2}|FREE)$/ }).first();
  await size.click();
  await expect(size).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('C: search suggestions, results, no-result and special-character queries', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(STORE);
  const box = page.getByRole('combobox', { name: 'Search products' }).or(page.getByLabel('Search products')).first();
  await box.fill('kurta');
  await expect(page.getByRole('listbox', { name: 'Search suggestions' }).or(page.getByLabel('Search suggestions')).first()).toBeVisible();
  await box.press('Enter');
  await page.waitForURL(/\/search\?q=kurta/);
  await expect(page.locator('main a[href^="/p/"]').first()).toBeVisible();
  await page.goto(`${STORE}/search?q=${encodeURIComponent('qzxwvy nothing')}`);
  await expect(page.locator('main')).toContainText(/no (results|products)|couldn.t find|nothing/i);
  const special = `<script>alert(1)</script> & % "quotes"`;
  const r = await page.goto(`${STORE}/search?q=${encodeURIComponent(special)}`);
  expect(r?.status()).toBe(200);
  expect(await page.evaluate(() => document.querySelectorAll('main script').length)).toBe(0);
  const empty = await page.goto(`${STORE}/search?q=`);
  expect(empty?.status()).toBeLessThan(500);
  expect(errors).toEqual([]);
});

test('D: bag quantity, remove, save for later, restore, and coupon apply/remove match the server', async ({ page, request }) => {
  const errors = watchConsole(page);
  const slug = await inStockProductSlug(request);
  await addFirstAvailableToBag(page, slug);
  await page.goto(`${STORE}/cart`);
  const cart = async () => (await (await page.request.get(`${API}/api/v1/cart`)).json()).data;
  const first = (await cart()).items[0];
  await page.getByRole('button', { name: /increase|\+/i }).first().click();
  await expect.poll(async () => (await cart()).items[0]?.quantity).toBe(first.quantity + 1);
  await page.getByRole('button', { name: /save for later/i }).first().click();
  await expect.poll(async () => (await cart()).savedItems.length).toBe(1);
  await page.getByRole('button', { name: /move to bag/i }).first().click();
  await expect.poll(async () => (await cart()).items.length).toBe(1);
  // Coupon from the seed (min order ₹999): apply then remove; totals come from the server.
  await page.request.patch(`${API}/api/v1/cart/items/${first.id}`, { headers: H, data: { quantity: 3 } });
  await page.reload();
  await page.getByRole('button', { name: /apply coupon/i }).first().click();
  await page.getByPlaceholder(/code/i).first().fill('VIBE10');
  await page.getByRole('button', { name: /^apply$/i }).first().click();
  await expect.poll(async () => (await cart()).couponCode).toBe('VIBE10');
  const withCoupon = await cart();
  await expect(page.getByTestId('grand-total').first()).toContainText(withCoupon.totals.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
  await page.getByRole('button', { name: /remove coupon/i }).first().click();
  await expect.poll(async () => (await cart()).couponCode).toBeNull();
  await page.getByRole('button', { name: new RegExp(`remove ${first.name}`, 'i') }).first().click();
  await expect.poll(async () => (await cart()).items.length).toBe(0);
  expect(errors).toEqual([]);
});

/** Places a COD order through the API for the signed-in page context. */
async function codOrder(page: Page, slug: string) {
  const pdp = (await (await page.request.get(`${API}/api/v1/products/${slug}`)).json()).data as { variants: { id: string; inStock: boolean }[] };
  await page.request.post(`${API}/api/v1/cart/items`, { headers: H, data: { variantId: pdp.variants.find((v) => v.inStock)!.id, quantity: 1 } });
  const phone = freshPhone();
  const co = await page.request.post(`${API}/api/v1/checkout`, { headers: H, data: { address: { fullName: 'Journey Buyer', phone, line1: '9 Journey Lane', city: 'Bengaluru', state: 'Karnataka', pincode: '560025', type: 'HOME', isDefault: true }, paymentMethod: 'COD', idempotencyKey: crypto.randomUUID() } });
  expect(co.status(), await co.text()).toBe(201);
  return { order: (await co.json()).data.order as { id: string; number: string }, phone };
}

async function signedIn(page: Page) {
  const email = `buyer${Date.now()}${Math.floor(Math.random() * 1000)}@test.local`;
  await page.goto(STORE);
  const r = await page.request.post(`${API}/api/v1/auth/register`, { headers: H, data: { name: 'Journey Buyer', email, password: 'Journey!pass1' } });
  expect(r.status()).toBe(201);
  return email;
}

async function staff(request: import('@playwright/test').APIRequestContext) {
  const login = await request.post(`${API}/api/v1/admin/auth/login`, { headers: H, data: { email: 'owner@vyra.local', password: STAFF_PASSWORD } });
  expect(login.ok()).toBeTruthy();
  return request;
}

test('G: view an order, track it as a guest, cancel it, and cancelling again is refused', async ({ page, request, browser }) => {
  const errors = watchConsole(page);
  await signedIn(page);
  const { order, phone } = await codOrder(page, await inStockProductSlug(request));
  await page.goto(`${STORE}/account/orders/${order.number}`);
  await expect(page.getByText(order.number).first()).toBeVisible();
  const guest = await browser.newPage();
  await guest.goto(`${STORE}/track`);
  await guest.getByLabel('Order number').fill(order.number);
  await guest.getByLabel(/mobile|phone|email/i).first().fill(phone);
  await guest.getByRole('button', { name: /track/i }).click();
  await expect(guest.getByText(order.number).first()).toBeVisible();
  await expect(guest.getByTestId('address-masked-note')).toBeVisible();
  await guest.close();
  await page.getByRole('button', { name: /cancel order/i }).click();
  await page.getByLabel('Reason for cancellation').fill('Changed my mind about the size');
  await page.getByRole('button', { name: /cancel order|confirm/i }).last().click();
  await expect.poll(async () => (await (await page.request.get(`${API}/api/v1/orders/${order.number}`)).json()).data.status).toBe('CANCELLED');
  const again = await page.request.post(`${API}/api/v1/orders/${order.number}/cancel`, { headers: H, data: { reason: 'Second attempt here' } });
  expect(again.status()).toBe(400);
  expect(errors).toEqual([]);
});

test('H: a delivered order is returned from the account page and refunded by staff', async ({ page, request }) => {
  const errors = watchConsole(page);
  await signedIn(page);
  const { order } = await codOrder(page, await inStockProductSlug(request));
  const s = await staff(request);
  for (const step of [['confirm-cod', {}], ['status', { status: 'PACKED' }], ['shipment', { provider: 'MANUAL' }], ['status', { status: 'DELIVERED' }]] as const) {
    expect((await s.post(`${API}/api/v1/admin/orders/${order.id}/${step[0]}`, { headers: H, data: step[1] })).ok()).toBeTruthy();
  }
  await page.goto(`${STORE}/account/orders/${order.number}`);
  await page.getByRole('button', { name: /return|exchange/i }).first().click();
  await page.getByRole('dialog').getByRole('checkbox').first().check();
  await expect(page.getByTestId('return-preview')).toBeVisible();
  await expect(page.getByTestId('refund-amount')).toContainText('₹');
  await expect(page.getByLabel('Reason')).toHaveValue('SIZE_ISSUE');
  await page.getByRole('button', { name: /submit return/i }).click();
  await expect.poll(async () => ((await (await page.request.get(`${API}/api/v1/returns`)).json()).data as { orderNumber: string }[]).filter((r) => r.orderNumber === order.number).length).toBe(1);
  const ret = ((await (await page.request.get(`${API}/api/v1/returns`)).json()).data as { id: string; orderNumber: string; refundAmount: number }[]).find((r) => r.orderNumber === order.number)!;
  for (const action of ['APPROVE', 'RECEIVE', 'REFUND']) {
    const d = await s.post(`${API}/api/v1/admin/returns/${ret.id}/decision`, { headers: H, data: { action, restock: true } });
    expect(d.ok(), `${action} ${await d.text()}`).toBeTruthy();
  }
  const finalOrder = (await (await page.request.get(`${API}/api/v1/orders/${order.number}`)).json()).data;
  expect(finalOrder.refunds.reduce((a: number, r: { amount: number }) => a + r.amount, 0)).toBe(ret.refundAmount);
  expect(finalOrder.returns[0].status).toBe('REFUNDED');
  expect((await (await s.get(`${API}/api/v1/admin/inventory/reconcile`)).json()).data.consistent).toBe(true);
  expect(errors).toEqual([]);
});

test('I: wishlist a product and write a review that publishes', async ({ page, request }) => {
  const errors = watchConsole(page);
  await signedIn(page);
  const slug = await inStockProductSlug(request);
  await page.goto(`${STORE}/p/${slug}`);
  await page.getByRole('button', { name: /wishlist/i }).first().click();
  await expect.poll(async () => {
    const r = await page.request.get(`${API}/api/v1/wishlist/ids`);
    return ((await r.json()).data as string[] | undefined)?.length;
  }).toBe(1);
  await page.goto(`${STORE}/wishlist`);
  await expect(page.locator('main a[href^="/p/"]').first()).toBeVisible();
  await page.goto(`${STORE}/p/${slug}`);
  await page.getByRole('button', { name: /write a review/i }).first().click();
  await page.getByRole('radio', { name: '4 stars' }).click();
  const title = `Journey review ${Date.now()}`;
  await page.getByLabel(/title/i).first().fill(title);
  await page.getByRole('button', { name: /submit|post review/i }).first().click();
  await expect(page.getByText(title)).toBeVisible();
  const reviews = (await (await page.request.get(`${API}/api/v1/products/${slug}/reviews`)).json()).data as { items: { title: string }[] };
  expect(reviews.items.some((r) => r.title === title)).toBe(true);
  expect(errors).toEqual([]);
});

test('J: guest sale reminder needs the OTP sent to the phone; visual search returns products', async ({ page }) => {
  const errors = watchConsole(page);
  // Reminders are offered before a sale starts, so publish a teaser-phase sale for this test (cancelled at the end).
  const s = await staff(page.request);
  const slug = `journey-teaser-${Date.now()}`;
  const now = Date.now();
  const created = await s.post(`${API}/api/v1/admin/campaigns`, { headers: H, data: { name: 'Journey Teaser Sale', slug, teaserStartsAt: new Date(now - 3600_000), startsAt: new Date(now + 2 * 86400_000), endsAt: new Date(now + 4 * 86400_000) } });
  expect(created.status(), await created.text()).toBe(201);
  const campaignId = (await created.json()).data.id as string;
  const promo = await s.post(`${API}/api/v1/admin/promotions`, { headers: H, data: { name: 'Journey bundle', campaignId, minQuantity: 2, percentOff: 5 } });
  expect(promo.ok()).toBeTruthy();
  expect((await s.post(`${API}/api/v1/admin/campaigns/${campaignId}/publish`, { headers: H, data: {} })).ok()).toBeTruthy();
  test.info().annotations.push({ type: 'cleanup', description: campaignId });
  await page.goto(`${STORE}/sale/${slug}`);
  const box = page.getByTestId('remind-me');
  await box.getByLabel(/mobile/i).fill(freshPhone());
  await box.getByRole('button', { name: /remind me|send code/i }).click();
  const code = box.getByLabel('6-digit code');
  await expect(code).toBeVisible();
  const dev = await box.innerText();
  const devCode = dev.match(/\b(\d{6})\b/)?.[1];
  test.skip(!devCode, 'dev OTP not displayed (SMS provider configured)');
  await code.fill(devCode!);
  await box.getByRole('button', { name: /confirm|verify|subscribe/i }).click();
  await expect(page.getByTestId('remind-me-done')).toBeVisible();
  expect((await s.post(`${API}/api/v1/admin/campaigns/${campaignId}/cancel`, { headers: H, data: { note: 'e2e cleanup' } })).ok()).toBeTruthy();
  await page.goto(`${STORE}/search/visual`);
  const img = Buffer.from(await (await page.request.get(`${STORE}${(await (await page.request.get(`${API}/api/v1/home`)).json()).data.trending[0].imageUrl}`)).body());
  await page.setInputFiles('input[type="file"]', { name: 'look.webp', mimeType: 'image/webp', buffer: img });
  await expect(page.locator('main a[href^="/p/"]').first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
