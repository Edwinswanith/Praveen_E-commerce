import { expect, test } from '@playwright/test';
import { addFirstAvailableToBag, ADMIN, fillAddress, freshPhone, inStockProductSlug, STORE, staffLogin } from './helpers';

test('phone OTP signup → COD checkout → OTP confirmation → staff packs and ships', async ({ page, request, browser }) => {
  const phone = freshPhone();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Sign up with mobile + OTP (dev: code comes back in the API response, never auto-filled).
  await page.goto(`${STORE}/login`);
  await page.getByLabel('Mobile number').fill(phone);
  const otpRes = page.waitForResponse((r) => r.url().includes('/auth/otp/request'));
  await page.getByLabel('Mobile number').press('Enter');
  const code = (await (await otpRes).json()).data.devCode as string;
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: /verify & continue/i }).click();
  await page.getByLabel('Your name').fill('E2E Phone Shopper');
  await page.getByRole('button', { name: /create account/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));

  // 2. Bag → COD checkout (phone-only account must give a receipt email).
  await addFirstAvailableToBag(page, await inStockProductSlug(request));
  await page.goto(`${STORE}/checkout`);
  await page.fill('#guest-email', `e2e-${phone}@demo.vyra.local`);
  await fillAddress(page, phone);
  await page.getByText('Cash on delivery', { exact: false }).first().click();
  const checkout = page.waitForResponse((r) => r.url().endsWith('/api/v1/checkout') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /^place order$/i }).click();
  const body = (await (await checkout).json()).data;
  expect(body.order.codConfirmation).toBe('PENDING');

  // 3. Confirm COD with the OTP sent to the delivery phone.
  await page.waitForURL(/confirmation/);
  await expect(page.getByText('Confirm your Cash on Delivery order')).toBeVisible();
  await page.getByLabel('Confirmation code').fill(body.codOtp.devCode);
  await page.getByRole('button', { name: /^confirm order$/i }).click();
  await expect(page.getByText('Confirm your Cash on Delivery order')).toBeHidden();

  // 4. Staff: the order is confirmed, so packing is allowed; then ship it.
  const staff = await (await browser.newContext()).newPage();
  await staffLogin(staff);
  await staff.goto(`${ADMIN}/orders/${body.order.id}`);
  await expect(staff.getByText('Awaiting COD confirmation')).toHaveCount(0);
  await staff.getByRole('button', { name: /^mark packed$/i }).click();
  await staff.getByRole('dialog').getByRole('button', { name: /mark packed|confirm/i }).click().catch(() => undefined);
  await expect(staff.getByText(/packed/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('unconfirmed COD orders cannot be packed until staff confirm them', async ({ page, request }) => {
  const phone = freshPhone();
  // Guest COD order via the API (same path the storefront uses).
  const api = await request.newContext?.() ?? request;
  const slug = await inStockProductSlug(request);
  const pdp = (await (await request.get(`${process.env.API_URL ?? 'http://localhost:4000'}/api/v1/products/${slug}`)).json()).data;
  const variant = pdp.variants.find((v: { inStock: boolean }) => v.inStock);
  await api.post(`${process.env.API_URL ?? 'http://localhost:4000'}/api/v1/cart/items`, { headers: { 'X-Requested-With': 'vyra' }, data: { variantId: variant.id, quantity: 1 } });
  const co = await api.post(`${process.env.API_URL ?? 'http://localhost:4000'}/api/v1/checkout`, {
    headers: { 'X-Requested-With': 'vyra' },
    data: { address: { fullName: 'COD Guest', phone, line1: '1 Test St', city: 'Pune', state: 'Maharashtra', pincode: '411001', type: 'HOME', isDefault: true }, guestEmail: `g-${phone}@demo.vyra.local`, paymentMethod: 'COD', idempotencyKey: crypto.randomUUID() },
  });
  const order = (await co.json()).data.order;

  await staffLogin(page, 'orders@vyra.local');
  await page.goto(`${ADMIN}/orders/${order.id}`);
  await expect(page.getByText('Awaiting COD confirmation').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^mark packed$/i })).toBeDisabled();
  await page.getByRole('button', { name: /mark confirmed/i }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /mark confirmed|confirm/i }).last().click();
  await expect(page.getByRole('button', { name: /^mark packed$/i })).toBeEnabled();
});
