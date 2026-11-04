import { expect, test, type APIRequestContext } from '@playwright/test';
import { addFirstAvailableToBag, API, inStockProductSlug, STAFF_PASSWORD, STORE } from './helpers';

type Funnel = { steps: { step: string; sessions: number }[]; bySource: { source: string; sessions: number }[] };

test('@mobile a shopper journey lands in the conversion funnel with its source and device', async ({ page, request }, info) => {
  // Log in once: polling with a fresh login each time would (correctly) trip the auth rate limit.
  const login = await request.post(`${API}/api/v1/admin/auth/login`, { headers: { 'X-Requested-With': 'vyra' }, data: { email: 'owner@vyra.local', password: STAFF_PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const funnel = async (r: APIRequestContext): Promise<Funnel> => (await (await r.get(`${API}/api/v1/admin/analytics/funnel`)).json()).data;
  // One stable first-touch source per project (desktop + mobile run in parallel). A unique source per run
  // piled up 1-session sources until ours fell outside the funnel's top-20 list and the test flaked.
  const source = `e2e_${info.project.name}`;
  const sessionsOf = (f: Funnel) => f.bySource.find((x) => x.source === source)?.sessions ?? 0;
  const before = await funnel(request);
  const slug = await inStockProductSlug(request);
  const views = page.waitForResponse((r) => r.url().includes('/api/v1/events') && r.status() === 202);
  await page.goto(`${STORE}/p/${slug}?utm_source=${source}`);
  await views;
  await addFirstAvailableToBag(page, slug);
  await expect.poll(async () => {
    const after = await funnel(request);
    const n = (f: Funnel, s: string) => f.steps.find((x) => x.step === s)!.sessions;
    return {
      ourSession: sessionsOf(after) - sessionsOf(before),
      viewsUp: n(after, 'PRODUCT_VIEW') > n(before, 'PRODUCT_VIEW'),
      cartsUp: n(after, 'ADD_TO_CART') > n(before, 'ADD_TO_CART'),
    };
  }, { timeout: 15_000 }).toEqual({ ourSession: 1, viewsUp: true, cartsUp: true });
});

test('@mobile sticky add-to-bag bar appears once the main button scrolls away', async ({ page, request, isMobile }) => {
  test.skip(!isMobile, 'mobile only');
  await page.goto(`${STORE}/p/${await inStockProductSlug(request)}`);
  const sticky = page.getByTestId('sticky-add-bar');
  // Off-screen + inert + aria-hidden when not needed (Playwright counts off-screen boxes as "visible").
  await expect(sticky).toHaveAttribute('data-visible', 'false');
  await expect(sticky).toHaveAttribute('aria-hidden', 'true');
  // Scroll just past the main Add to bag button (not into the footer, where the bar hides again).
  const main = page.getByRole('button', { name: /add to bag/i }).first();
  const box = (await main.boundingBox())!;
  await page.evaluate((y) => window.scrollTo(0, y), box.y + box.height + 120);
  await expect(sticky).toHaveAttribute('data-visible', 'true');
  await expect(sticky).toBeInViewport();
});
