#!/usr/bin/env node
/**
 * Repeatable API latency benchmark (no dependencies). Run against an ISOLATED
 * environment only (local stack or staging), never production.
 *
 *   API_URL=http://localhost:4000 STAFF_EMAIL=... STAFF_PASSWORD=... node scripts/perf/bench.mjs [requests] [concurrency]
 *
 * Optional DB_URL enables queries-per-request via pg_stat_statements (psql must
 * be installed and the extension loaded). API_PID enables RSS/CPU sampling.
 * Each request gets a distinct X-Forwarded-For so per-IP throttles model
 * many shoppers (only meaningful when the API trusts one proxy hop).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const N = Number(process.argv[2] ?? 200);
const C = Number(process.argv[3] ?? 10);
const H = { 'X-Requested-With': 'vyra', 'content-type': 'application/json' };
let ip = 0;
const xff = () => `10.${(ip >> 16) & 255}.${(ip >> 8) & 255}.${ip++ & 255}`;

function psql(sql) {
  if (!process.env.DB_URL) return null;
  try { return execFileSync('psql', [process.env.DB_URL, '-tAc', sql], { encoding: 'utf8' }).trim(); } catch { return null; }
}
const statementCalls = () => Number(psql("select coalesce(sum(calls),0) from pg_stat_statements where query not ilike '%pg_stat_statements%'") ?? NaN);

function procSample() {
  const pid = process.env.API_PID;
  if (!pid) return null;
  try {
    const st = readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ');
    const rss = Number(readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]) / 1024;
    return { cpuTicks: Number(st[13]) + Number(st[14]), rssMb: rss };
  } catch { return null; }
}

async function login(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { ...H, 'X-Forwarded-For': xff() }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

async function bench(name, make) {
  for (let i = 0; i < Math.min(10, N); i++) await make(); // warm up
  psql('select pg_stat_statements_reset()');
  const q0 = statementCalls();
  const p0 = procSample();
  const times = []; let errors = 0; let i = 0; let peakRss = p0?.rssMb ?? 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: C }, async () => {
    while (i < N) {
      i++;
      const s = performance.now();
      try { const r = await make(); if (!r.ok) errors++; await r.arrayBuffer(); } catch { errors++; }
      times.push(performance.now() - s);
      const ps = procSample(); if (ps) peakRss = Math.max(peakRss, ps.rssMb);
    }
  }));
  const wall = (performance.now() - t0) / 1000;
  const p1 = procSample();
  const q1 = statementCalls();
  times.sort((a, b) => a - b);
  const row = {
    endpoint: name, requests: times.length, concurrency: C, errors,
    p50: +pct(times, 50).toFixed(1), p95: +pct(times, 95).toFixed(1), p99: +pct(times, 99).toFixed(1), max: +times.at(-1).toFixed(1),
    rps: +(times.length / wall).toFixed(1),
    queriesPerReq: Number.isFinite(q1 - q0) ? +((q1 - q0 - 1) / times.length).toFixed(1) : null,
    cpuPct: p0 && p1 ? +(((p1.cpuTicks - p0.cpuTicks) / 100 / wall) * 100).toFixed(0) : null,
    peakRssMb: p0 ? +peakRss.toFixed(0) : null,
  };
  console.log(JSON.stringify(row));
  return row;
}

const get = (path, cookie) => () => fetch(`${API}${path}`, { headers: { 'X-Forwarded-For': xff(), ...(cookie ? { cookie } : {}) } });
const post = (path, body, cookie) => () => fetch(`${API}${path}`, { method: 'POST', headers: { ...H, 'X-Forwarded-For': xff(), ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

const products = (await (await fetch(`${API}/api/v1/products?pageSize=24&inStock=true`)).json()).data.items;
const slug = products[0].slug;
const detail = (await (await fetch(`${API}/api/v1/products/${slug}`)).json()).data;
// A guest bag with two lines, reused for bag/quote requests.
const bagRes = await fetch(`${API}/api/v1/cart/items`, { method: 'POST', headers: { ...H, 'X-Forwarded-For': xff() }, body: JSON.stringify({ variantId: detail.variants.find((v) => v.inStock).id, quantity: 1 }) });
const bagCookie = bagRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const staff = process.env.STAFF_EMAIL ? await login('/api/v1/admin/auth/login', { email: process.env.STAFF_EMAIL, password: process.env.STAFF_PASSWORD }) : null;
const campaigns = staff ? (await (await fetch(`${API}/api/v1/admin/campaigns`, { headers: { cookie: staff } })).json()).data : [];

const rows = [];
rows.push(await bench('GET /health', get('/api/v1/health')));
rows.push(await bench('GET /home', get('/api/v1/home')));
rows.push(await bench('GET /categories', get('/api/v1/categories')));
rows.push(await bench('GET /campaigns/current', get('/api/v1/campaigns/current')));
rows.push(await bench('GET /products (24, in stock)', get('/api/v1/products?pageSize=24&inStock=true')));
rows.push(await bench('GET /products (sort price, filter size)', get('/api/v1/products?pageSize=24&sort=price_asc&sizes=M')));
rows.push(await bench('GET /products/:slug', get(`/api/v1/products/${slug}`)));
rows.push(await bench('GET /products/:slug/related', get(`/api/v1/products/${slug}/related`)));
rows.push(await bench('GET /search/suggest', get('/api/v1/search/suggest?q=kur')));
rows.push(await bench('GET /cart (1 line)', get('/api/v1/cart', bagCookie)));
rows.push(await bench('POST /checkout/quote', post('/api/v1/checkout/quote', { shippingMethod: 'STANDARD', paymentMethod: 'COD', pincode: '560001' }, bagCookie)));
if (staff) {
  rows.push(await bench('GET /admin/dashboard', get('/api/v1/admin/dashboard', staff)));
  rows.push(await bench('GET /admin/orders', get('/api/v1/admin/orders?pageSize=20', staff)));
  rows.push(await bench('GET /admin/inventory', get('/api/v1/admin/inventory?pageSize=50', staff)));
  if (campaigns[0]) rows.push(await bench('GET /admin/campaigns/:id/report', get(`/api/v1/admin/campaigns/${campaigns[0].id}/report`, staff)));
}
console.log('\nSUMMARY ' + JSON.stringify(rows));
