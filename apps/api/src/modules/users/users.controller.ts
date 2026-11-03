import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Address } from '@prisma/client';
import { addressSchema, paginationSchema, staffUserSchema, updateProfileSchema, type AddressDto, type RoleName } from '@vyra/shared';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { badRequest, conflict, forbidden, notFound } from '../../common/http/errors';
import { paginated } from '../../common/http/envelope';
import { CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from '../auth/auth.decorators';
import { AuthService, sessionInclude, toSessionUser } from '../auth/auth.service';
import { assignableRoles } from '../roles/permissions';

export function toAddressDto(a: Address): AddressDto {
  return {
    id: a.id, fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2, landmark: a.landmark, city: a.city,
    state: a.state, pincode: a.pincode, type: a.type, isDefault: a.isDefault,
  };
}

@ApiTags('users')
@Controller('users/me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Patch()
  async update(@CurrentUser() u: AuthUser, @Body(new ZodPipe(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>) {
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    if (body.phone !== undefined && body.phone !== current.phone) {
      if (current.phoneVerifiedAt && !current.email) throw badRequest('Your phone is your login. Add an email before changing it.');
      const taken = body.phone ? await this.prisma.user.findFirst({ where: { phone: body.phone, phoneVerifiedAt: { not: null }, NOT: { id: u.id } } }) : null;
      if (taken) throw conflict('This phone number is linked to another account');
      if (body.phone) await this.prisma.user.updateMany({ where: { phone: body.phone, phoneVerifiedAt: null, NOT: { id: u.id } }, data: { phone: null } });
    }
    if (body.email && body.email !== current.email) {
      if (await this.prisma.user.findFirst({ where: { email: body.email, NOT: { id: u.id } } })) throw conflict('This email is linked to another account');
    }
    const { marketingOptIn, ...userData } = body;
    const user = await this.prisma.user.update({
      where: { id: u.id },
      data: {
        ...userData,
        ...(body.phone !== undefined && body.phone !== current.phone ? { phoneVerifiedAt: null } : {}),
        ...(body.email && body.email !== current.email ? { emailVerifiedAt: null } : {}),
        ...(marketingOptIn !== undefined ? { customerProfile: { upsert: { create: { marketingOptIn }, update: { marketingOptIn } } } } : {}),
      },
      include: sessionInclude,
    });
    return toSessionUser(user);
  }

  @Get('addresses')
  async list(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.address.findMany({ where: { userId: u.id, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
    return rows.map(toAddressDto);
  }

  @Post('addresses')
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(addressSchema)) body: z.infer<typeof addressSchema>) {
    const count = await this.prisma.address.count({ where: { userId: u.id, deletedAt: null } });
    if (count >= 20) throw badRequest('You can save up to 20 addresses');
    const isDefault = body.isDefault || count === 0;
    const a = await this.prisma.$transaction(async (tx) => {
      if (isDefault) await tx.address.updateMany({ where: { userId: u.id }, data: { isDefault: false } });
      return tx.address.create({ data: { ...body, isDefault, userId: u.id } });
    });
    return toAddressDto(a);
  }

  @Patch('addresses/:id')
  async patch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(addressSchema.partial())) body: Partial<z.infer<typeof addressSchema>>) {
    const existing = await this.prisma.address.findFirst({ where: { id, userId: u.id, deletedAt: null } });
    if (!existing) throw notFound('Address');
    const a = await this.prisma.$transaction(async (tx) => {
      if (body.isDefault) await tx.address.updateMany({ where: { userId: u.id }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: body });
    });
    return toAddressDto(a);
  }

  @Delete('addresses/:id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const existing = await this.prisma.address.findFirst({ where: { id, userId: u.id, deletedAt: null } });
    if (!existing) throw notFound('Address');
    // Soft delete: past orders snapshot the address, but keep the row for audit.
    await this.prisma.address.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
    if (existing.isDefault) {
      const next = await this.prisma.address.findFirst({ where: { userId: u.id, deletedAt: null }, orderBy: { updatedAt: 'desc' } });
      if (next) await this.prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return { ok: true };
  }
}

@ApiTags('admin:users')
@StaffOnly()
@Controller('admin/users')
export class StaffUsersController {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly audit: AuditService) {}

  @RequirePermissions('staff:manage') @Get()
  async list() {
    const users = await this.prisma.user.findMany({
      where: { role: { name: { not: 'CUSTOMER' } }, deletedAt: null }, include: { role: true }, orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({ ...toSessionUser(u), isActive: u.isActive, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt }));
  }

  @RequirePermissions('staff:manage') @Post()
  async create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(staffUserSchema)) body: z.infer<typeof staffUserSchema>) {
    if (!assignableRoles(actor.role).includes(body.role)) throw forbidden(`You cannot create ${body.role} accounts`);
    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: body.role } });
    const user = await this.prisma.user.create({
      data: { name: body.name, email: body.email, passwordHash: await this.auth.hash(body.password), roleId: role.id, emailVerifiedAt: new Date() },
      include: { role: true },
    });
    await this.audit.log({ actorId: actor.id, action: 'staff.create', entity: 'User', entityId: user.id, after: { email: user.email, role: body.role } });
    return toSessionUser(user);
  }

  @RequirePermissions('staff:manage') @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ role: z.enum(['ADMIN', 'INVENTORY_MANAGER', 'ORDER_MANAGER']).optional(), isActive: z.boolean().optional() }))) body: { role?: RoleName; isActive?: boolean }) {
    if (id === actor.id) throw badRequest('You cannot change your own role or status');
    const target = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!target || target.role.name === 'CUSTOMER') throw notFound('Staff user');
    const allowed = assignableRoles(actor.role);
    if (!allowed.includes(target.role.name as RoleName) || (body.role && !allowed.includes(body.role))) throw forbidden();
    const role = body.role ? await this.prisma.role.findUniqueOrThrow({ where: { name: body.role } }) : null;
    const user = await this.prisma.user.update({ where: { id }, data: { roleId: role?.id, isActive: body.isActive }, include: { role: true } });
    if (body.isActive === false) await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ actorId: actor.id, action: 'staff.update', entity: 'User', entityId: id, before: { role: target.role.name, isActive: target.isActive }, after: body });
    return { ...toSessionUser(user), isActive: user.isActive };
  }
}

@ApiTags('admin:audit')
@StaffOnly()
@Controller('admin/audit-logs')
export class AuditLogController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermissions('audit:read') @Get()
  async list(@Query(new ZodPipe(paginationSchema.extend({ entity: z.string().max(40).optional() }))) q: { page: number; pageSize: number; entity?: string }) {
    const where = q.entity ? { entity: q.entity } : {};
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, include: { actor: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(rows.map((r) => ({ id: r.id, action: r.action, entity: r.entity, entityId: r.entityId, actorName: r.actor?.name ?? null, before: r.before, after: r.after, createdAt: r.createdAt.toISOString() })), total, q.page, q.pageSize);
  }
}
