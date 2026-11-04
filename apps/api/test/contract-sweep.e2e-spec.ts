import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import request from 'supertest';
import { API_PREFIX, WEBHOOK_PATHS } from '@vyra/shared';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ZodPipe } from '../src/common/http/zod.pipe';
import { AUDIENCE, IS_PUBLIC, OPTIONAL_AUTH, PERMISSIONS_KEY } from '../src/modules/auth/auth.decorators';
import { ROLE_PERMISSIONS, type Permission } from '../src/modules/roles/permissions';
import { bootApp, createStaff, H, registerCustomer } from './helpers';

/**
 * Contract sweep over EVERY route registered in the running app (discovered
 * from Nest metadata, so it can't drift from the code). For each route it checks
 * authentication, realm isolation, role permissions, CSRF, request validation,
 * unknown ids and the response envelope. Results are written to SWEEP_OUT for
 * the API verification matrix.
 */
type Audience = 'customer' | 'staff';
interface Route {
  method: string; path: string; handler: string; controller: string;
  isPublic: boolean; optional: boolean; audience: Audience; perms: Permission[];
  hasBodySchema: boolean; hasQuerySchema: boolean; params: string[];
}
type Agent = ReturnType<typeof request.agent>;
const STAFF_ROLES = ['ADMIN', 'INVENTORY_MANAGER', 'ORDER_MANAGER'] as const;
const FAKE: Record<string, string> = { slug: 'no-such-thing-xyz', number: 'VY00000000000', sku: 'NOPE-SKU-0', file: 'cnotarealid0000000000000.png', phone: '9000000001', pincode: '999999', variantId: 'cnotarealid000000000000000', productId: 'cnotarealid000000000000000' };
const fake = (p: string) => FAKE[p] ?? 'cnotarealid000000000000000';

/**
 * Documented, intended exceptions (each one checked by a dedicated test elsewhere):
 * - Public routes whose job is to check a session answer 401 without one.
 * - Idempotent DELETEs answer 200 for an id that is already gone.
 * - Webhooks without configured credentials answer 503 NOT_CONFIGURED.
 */
const SESSION_CHECKING_PUBLIC = new Set(['POST /api/v1/auth/refresh', 'POST /api/v1/admin/auth/refresh', 'DELETE /api/v1/campaigns/:slug/remind-me']);
// Deleting something already gone is success. AI previews: "keep original" must not fail when the preview already expired.
const IDEMPOTENT_DELETE = new Set(['DELETE /api/v1/wishlist/:productId', 'DELETE /api/v1/admin/cod/blocked-pincodes/:pincode', 'DELETE /api/v1/admin/products/:id/images/ai-previews/:previewId']);
const NOT_CONFIGURED_OK = new Set(['POST /api/v1/shipping/shiprocket/webhook']);

function discover(app: INestApplication): Route[] {
  const out: Route[] = [];
  const meta = <T>(key: string, ...targets: object[]): T | undefined => {
    for (const t of targets) { const v = Reflect.getMetadata(key, t); if (v !== undefined) return v as T; }
    return undefined;
  };
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as unknown as { name: string; prototype: Record<string, unknown> };
      if (!ctrl?.prototype) continue;
      const base = (Reflect.getMetadata(PATH_METADATA, ctrl) as string | undefined) ?? '';
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const fn = ctrl.prototype[name] as object;
        if (name === 'constructor' || typeof fn !== 'function') continue;
        const m = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
        const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined;
        if (m === undefined || sub === undefined) continue;
        const path = `${API_PREFIX}/${[base, sub].map((x) => x.replace(/^\/|\/$/g, '')).filter(Boolean).join('/')}`;
        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, name) ?? {}) as Record<string, { pipes?: unknown[] }>;
        const pipedArg = (type: number) => Object.entries(args).some(([k, v]) => k.startsWith(`${type}:`) && (v.pipes ?? []).some((p) => p instanceof ZodPipe));
        out.push({
          method: RequestMethod[m], path, handler: name, controller: ctrl.name,
          isPublic: !!meta<boolean>(IS_PUBLIC, fn, ctrl), optional: !!meta<boolean>(OPTIONAL_AUTH, fn, ctrl),
          audience: meta<Audience>(AUDIENCE, fn, ctrl) ?? 'customer', perms: meta<Permission[]>(PERMISSIONS_KEY, fn, ctrl) ?? [],
          // RouteParamtypes: BODY = 3, QUERY = 4
          hasBodySchema: pipedArg(3), hasQuerySchema: pipedArg(4),
          params: [...path.matchAll(/:(\w+)/g)].map((x) => x[1]!),
        });
      }
    }
  }
  return out;
}

describe('Contract sweep over every registered route (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let routes: Route[];
  const staff: Record<string, Agent> = {};
  let customer: Agent;
  const results = new Map<string, Record<string, string>>();
  const key = (r: Route) => `${r.method} ${r.path}`;
  const note = (r: Route, check: string, outcome: string) => results.set(key(r), { ...(results.get(key(r)) ?? {}), [check]: outcome });

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    routes = discover(app);
    for (const role of ['SUPER_ADMIN', ...STAFF_ROLES]) staff[role] = await createStaff(app, role as never, `${role.toLowerCase()}@sweep.local`);
    customer = await registerCustomer(app, 'sweeper@test.local');
  });
  afterAll(async () => {
    if (process.env.SWEEP_OUT) writeFileSync(process.env.SWEEP_OUT, JSON.stringify(routes.map((r) => ({ ...r, checks: results.get(key(r)) ?? {} })), null, 1));
    await app.close();
  });

  const url = (r: Route) => r.path.replace(/:(\w+)/g, (_m, p: string) => fake(p));
  const isWebhook = (r: Route) => (WEBHOOK_PATHS as readonly string[]).includes(r.path);
  function call(agent: Agent | null, r: Route, opts: { csrf?: boolean; body?: unknown; query?: Record<string, string> } = {}) {
    const a = agent ?? request(app.getHttpServer());
    const verb = r.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    let req = (a as unknown as Record<string, (u: string) => request.Test>)[verb]!(url(r)).set('X-Forwarded-For', `10.200.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`);
    if (opts.csrf !== false) req = req.set(H);
    if (opts.query) req = req.query(opts.query);
    if (r.method !== 'GET') req = req.send((opts.body ?? {}) as object);
    return req;
  }
  /** The identity allowed to call a route (for validation / not-found probes). */
  const allowed = (r: Route): Agent | null => (r.audience === 'staff' && !r.isPublic ? staff.SUPER_ADMIN! : !r.isPublic ? customer : r.optional ? customer : null);
  function envelopeProblem(res: request.Response): string | null {
    if (res.type !== 'application/json') return null;
    const b = res.body as Record<string, unknown>;
    if (JSON.stringify(b).includes('"stack"')) return 'response contains a stack trace';
    if (res.status >= 400) {
      const e = b.error as { code?: unknown; message?: unknown } | undefined;
      if (!e || typeof e.code !== 'string' || typeof e.message !== 'string') return `error envelope missing: ${JSON.stringify(b).slice(0, 120)}`;
    } else if (res.status < 300 && !('data' in b) && !('ok' in b)) return `success envelope missing data: ${JSON.stringify(b).slice(0, 120)}`;
    return null;
  }

  it('discovers the full route set', () => {
    expect(routes.length).toBeGreaterThanOrEqual(168);
    expect(new Set(routes.map(key)).size).toBe(routes.length);
  });

  it('rejects unauthenticated calls to every protected route with 401 and the error envelope', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic)) {
      const res = await call(null, r);
      const ok = res.status === 401 && res.body?.error?.code === 'UNAUTHORIZED';
      note(r, 'unauthenticated', ok ? 'PASS 401' : `FAIL ${res.status}`);
      if (!ok) bad.push(`${key(r)} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('never lets a public route answer 401/403 or 500 to an anonymous caller', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => x.isPublic)) {
      const res = await call(null, r, { body: [] });
      const ok = (res.status !== 401 || SESSION_CHECKING_PUBLIC.has(key(r))) && (res.status < 500 || (NOT_CONFIGURED_OK.has(key(r)) && res.body?.error?.code === 'NOT_CONFIGURED')) && !(res.status === 403 && res.body?.error?.message === 'Missing CSRF header');
      note(r, 'anonymous', `${ok ? 'PASS' : 'FAIL'} ${res.status}`);
      if (!ok) bad.push(`${key(r)} -> ${res.status} ${res.body?.error?.message ?? ''}`);
    }
    expect(bad).toEqual([]);
  });

  it('isolates realms: customer tokens never reach staff routes, staff tokens never reach customer-only routes', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic)) {
      const other = r.audience === 'staff' ? customer : staff.SUPER_ADMIN!;
      const res = await call(other, r, { body: [] });
      const ok = res.status === 401;
      note(r, 'realm', ok ? 'PASS 401' : `FAIL ${res.status}`);
      if (!ok) bad.push(`${key(r)} (${r.audience}) -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('enforces the permission matrix on every staff route for every role', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => x.audience === 'staff' && !x.isPublic)) {
      const outcomes: string[] = [];
      for (const role of STAFF_ROLES) {
        const granted = r.perms.every((p) => ROLE_PERMISSIONS[role].includes(p));
        const res = await call(staff[role]!, r, { body: [] });
        const ok = granted ? res.status !== 403 && res.status !== 401 && res.status < 500 : res.status === 403 && res.body?.error?.code === 'FORBIDDEN';
        outcomes.push(`${role}:${granted ? 'allow' : 'deny'}=${res.status}`);
        if (!ok) bad.push(`${key(r)} ${role} expected ${granted ? 'allowed' : '403'} got ${res.status}`);
      }
      note(r, 'rbac', `${bad.some((b) => b.startsWith(key(r) + ' ')) ? 'FAIL' : 'PASS'} ${outcomes.join(' ')}`);
    }
    expect(bad).toEqual([]);
  });

  it('requires the CSRF header on every cookie-authenticated mutation except the exact webhook paths', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => x.method !== 'GET')) {
      const res = await call(allowed(r), r, { csrf: false, body: [] });
      const csrf = res.status === 403 && res.body?.error?.message === 'Missing CSRF header';
      const ok = isWebhook(r) ? !csrf : csrf;
      note(r, 'csrf', `${ok ? 'PASS' : 'FAIL'} ${isWebhook(r) ? 'exempt' : 'required'} ${res.status}`);
      if (!ok) bad.push(`${key(r)} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('answers malformed bodies with 422 VALIDATION_FAILED on every schema-validated route', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => x.hasBodySchema)) {
      const res = await call(allowed(r), r, { body: [1, 'not-an-object'] });
      const d = res.body?.error?.details as { fieldErrors?: unknown; formErrors?: unknown } | undefined;
      // A route may legitimately 404 on the (fake) path id before validating the body.
      const ok = (res.status === 422 && res.body?.error?.code === 'VALIDATION_FAILED' && typeof d?.fieldErrors === 'object' && Array.isArray(d?.formErrors)) || (r.params.length > 0 && res.status === 404);
      note(r, 'validation', `${ok ? 'PASS' : 'FAIL'} ${res.status}`);
      if (!ok) bad.push(`${key(r)} -> ${res.status} ${JSON.stringify(res.body).slice(0, 100)}`);
    }
    expect(bad).toEqual([]);
  });

  it('answers unknown ids with a 4xx (never 2xx or 5xx) on every parameterised route', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => x.params.length && !isWebhook(x))) {
      const res = await call(allowed(r), r, { body: {} });
      const ok = (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403) || (IDEMPOTENT_DELETE.has(key(r)) && res.status === 200);
      note(r, 'unknown-id', `${ok ? 'PASS' : 'FAIL'} ${res.status}`);
      if (!ok) bad.push(`${key(r)} -> ${res.status} ${JSON.stringify(res.body).slice(0, 100)}`);
    }
    expect(bad).toEqual([]);
  });

  it('uses the documented envelope on every response observed in this sweep and never leaks stacks', async () => {
    const bad: string[] = [];
    for (const r of routes) {
      const res = await call(allowed(r), r, { body: {} });
      const p = res.status >= 500 && !(NOT_CONFIGURED_OK.has(key(r)) && res.status === 503 && res.body?.error?.code === 'NOT_CONFIGURED') ? `server error ${res.status}` : envelopeProblem(res);
      note(r, 'envelope', p ? `FAIL ${p}` : `PASS ${res.status}`);
      if (p) bad.push(`${key(r)}: ${p}`);
    }
    expect(bad).toEqual([]);
    // The sweep must not have corrupted stock: every probe that changes stock goes through the ledger.
    expect((await staff.SUPER_ADMIN!.get(`${API_PREFIX}/admin/inventory/reconcile`).expect(200)).body.data.consistent).toBe(true);
    expect(await prisma.order.count()).toBe(0);
  });
});
