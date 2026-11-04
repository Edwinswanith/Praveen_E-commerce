import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { appendFileSync } from 'node:fs';
import type { Request, Response } from 'express';
import type { ProductInput } from '@vyra/shared';
import { createApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { ROLE_PERMISSIONS } from '../src/modules/roles/permissions';

export const PASSWORD = 'Passw0rd!x';

/**
 * Test-only route coverage recorder: when ROUTE_COVERAGE_FILE is set, every
 * request records its matched route pattern, status and the test that sent it,
 * so the API verification matrix is built from observed runtime behaviour.
 */
function recordCoverage(app: INestApplication) {
  const file = process.env.ROUTE_COVERAGE_FILE;
  if (!file) return;
  app.use((req: Request & { route?: { path: string } }, res: Response, next: () => void) => {
    res.on('finish', () => {
      const st = expect.getState();
      appendFileSync(file, JSON.stringify({ m: req.method, r: req.route?.path ?? null, u: req.originalUrl.split('?')[0], s: res.statusCode, f: st.testPath?.split('/').pop(), t: st.currentTestName }) + '\n');
    });
    next();
  });
}

export async function bootApp() {
  const app = await createApp();
  recordCoverage(app);
  await app.init();
  const prisma = app.get(PrismaService);
  await resetDb(prisma);
  return { app, prisma, http: () => request(app.getHttpServer()) };
}

export async function resetDb(prisma: PrismaService) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // The ledger trigger forbids DELETE; TRUNCATE is a test-only reset.
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  for (const name of Object.keys(ROLE_PERMISSIONS)) await prisma.role.create({ data: { name: name as never } });
}

export async function createStaff(app: INestApplication, role: 'SUPER_ADMIN' | 'ADMIN' | 'INVENTORY_MANAGER' | 'ORDER_MANAGER', email = `${role.toLowerCase()}@test.local`) {
  const prisma = app.get(PrismaService);
  const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  await prisma.user.create({ data: { email, name: role, roleId: r.id, passwordHash: await app.get(AuthService).hash(PASSWORD), emailVerifiedAt: new Date() } });
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/v1/admin/auth/login').set('X-Requested-With', 'vyra').send({ email, password: PASSWORD }).expect(200);
  return agent;
}

export async function registerCustomer(app: INestApplication, email = 'shopper@test.local') {
  const agent = request.agent(app.getHttpServer());
  await agent.post('/api/v1/auth/register').set('X-Requested-With', 'vyra').send({ name: 'Test Shopper', email, password: PASSWORD }).expect(201);
  return agent;
}

export async function createCategory(prisma: PrismaService, slug = 'men-tshirts', code = 'TSH') {
  return prisma.category.create({ data: { name: slug, slug, code } });
}

export function productInput(categoryId: string, over: Partial<ProductInput> = {}): ProductInput {
  return {
    name: 'Oversized Black Cotton Tee', description: 'A breathable oversized cotton t-shirt for summer.', brand: 'VYRA', gender: 'MEN', categoryId,
    status: 'ACTIVE', tags: ['oversized', 'summer'], attributes: { fabric: 'Cotton', fit: 'Oversized' }, hsnCode: '6109', isFeatured: false,
    variants: [
      { color: 'Black', colorHex: '#111111', size: 'M', mrp: 1299, price: 799, weightGrams: 300, lowStockThreshold: 2, isActive: true },
      { color: 'Black', colorHex: '#111111', size: 'L', mrp: 1299, price: 799, weightGrams: 300, lowStockThreshold: 2, isActive: true },
      { color: 'White', colorHex: '#ffffff', size: 'M', mrp: 1299, price: 799, weightGrams: 300, lowStockThreshold: 2, isActive: true },
    ],
    ...over,
  };
}

export const H = { 'X-Requested-With': 'vyra' };
