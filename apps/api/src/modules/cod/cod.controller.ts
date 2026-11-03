import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { codPincodeSchema, codRiskUpdateSchema, indianMobileSchema, paginationSchema } from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import { paginated } from '../../common/http/envelope';
import { CurrentUser, RequirePermissions, StaffOnly, type AuthUser } from '../auth/auth.decorators';
import { CodService, toCodRiskDto } from './cod.service';

@ApiTags('admin:cod')
@StaffOnly()
@Controller('admin/cod')
export class AdminCodController {
  constructor(private readonly cod: CodService, private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @RequirePermissions('orders:read') @Get('settings')
  settings() {
    return this.cod.settings();
  }

  @RequirePermissions('orders:write') @Post('blocked-pincodes')
  async block(@CurrentUser() u: AuthUser, @Body(new ZodPipe(codPincodeSchema)) b: z.infer<typeof codPincodeSchema>) {
    await this.prisma.codBlockedPincode.upsert({ where: { pincode: b.pincode }, create: { pincode: b.pincode, reason: b.reason }, update: { reason: b.reason } });
    await this.audit.log({ actorId: u.id, action: 'cod.pincode.block', entity: 'CodBlockedPincode', entityId: b.pincode, after: b });
    return this.cod.settings();
  }

  @RequirePermissions('orders:write') @Delete('blocked-pincodes/:pincode')
  async unblock(@CurrentUser() u: AuthUser, @Param('pincode') pincode: string) {
    await this.prisma.codBlockedPincode.deleteMany({ where: { pincode } });
    await this.audit.log({ actorId: u.id, action: 'cod.pincode.unblock', entity: 'CodBlockedPincode', entityId: pincode });
    return this.cod.settings();
  }

  @RequirePermissions('orders:read') @Get('risks')
  async risks(@Query(new ZodPipe(paginationSchema.extend({ blocked: z.enum(['true', 'false']).optional() }))) q: { page: number; pageSize: number; q?: string; blocked?: string }) {
    const where = { ...(q.q ? { phone: { contains: q.q } } : {}), ...(q.blocked ? { codBlocked: q.blocked === 'true' } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.codRisk.findMany({ where, orderBy: [{ codBlocked: 'desc' }, { rtoCount: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.codRisk.count({ where }),
    ]);
    return paginated(rows.map(toCodRiskDto), total, q.page, q.pageSize);
  }

  @RequirePermissions('orders:write') @Patch('risks/:phone')
  async updateRisk(@CurrentUser() u: AuthUser, @Param('phone') raw: string, @Body(new ZodPipe(codRiskUpdateSchema)) b: z.infer<typeof codRiskUpdateSchema>) {
    const phone = indianMobileSchema.parse(raw);
    const r = await this.prisma.codRisk.upsert({ where: { phone }, create: { phone, codBlocked: b.codBlocked, note: b.note }, update: { codBlocked: b.codBlocked, note: b.note } });
    await this.audit.log({ actorId: u.id, action: b.codBlocked ? 'cod.customer.block' : 'cod.customer.unblock', entity: 'CodRisk', entityId: phone, after: b });
    return toCodRiskDto(r);
  }
}
