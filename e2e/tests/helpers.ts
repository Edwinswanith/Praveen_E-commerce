import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const STORE = process.env.STOREFRONT_URL ?? 'http://localhost:3000';
export const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3001';
export const API = process.env.API_URL ?? 'http://localhost:4000';
export const STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? 'VyraStaff@2026';
export const H = { 'X-Requested-With': 'vyra' };

/** Unique Indian mobile per run so tests never collide with earlier data. */
export function freshPhone() {
  return `9${String(Date.now()).slice(-9)}`;
}

export async function inStockProductSlug(request: APIRequestContext) {
  const r = await request.get(`${API}/api/v1/products?inStock=true&pageSize=24&sort=popularity`);
  const items = (await r.json()).data.items as { slug: string; inStock: boolean }[];
  return items.find((i) => i.inStock)!.slug;
}

/** Selects the first available size on a PDP and adds it to the bag. */
export async function addFirstAvailableToBag(page: Page, slug: string) {
  await page.goto(`${STORE}/p/${slug}`);
  await page.locator('button:not([disabled])', { hasText: /^(XS|S|M|L|XL|XXL|\d{1,2}|FREE)$/ }).first().click();
  const added = page.waitForResponse((r) => r.url().includes('/api/v1/cart/items') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /add to bag/i }).first().click();
  expect((await added).ok()).toBeTruthy();
}

export async function fillAddress(page: Page, phone: string) {
  await page.getByLabel('Full name').fill('E2E Shopper');
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByLabel('Address (house no, building, street)').fill('42 Test Lane');
  await page.getByLabel('City').fill('Bengaluru');
  await page.getByLabel('State').selectOption('Karnataka');
  await page.getByLabel('PIN code').fill('560025');
}

export async function staffLogin(page: Page, email = 'owner@vyra.local') {
  await page.goto(`${ADMIN}/login`);
  await page.fill('#email', email);
  await page.fill('#password', STAFF_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
