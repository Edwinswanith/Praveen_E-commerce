import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { categorySchema, type CategoryInput } from '@vyra/shared';
import { ZodPipe } from '../../common/http/zod.pipe';
import { AuditService } from '../../common/audit/audit.service';
import { CurrentUser, Public, RequirePermissions, StaffOnly, type AuthUser } from '../auth/auth.decorators';
import { CategoriesService } from './categories.service';

@ApiTags('categories')
@Public()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  tree() {
    return this.categories.tree();
  }

  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.categories.bySlug(slug);
  }
}

@ApiTags('admin:categories')
@StaffOnly()
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService, private readonly audit: AuditService) {}

  @RequirePermissions('catalog:read') @Get()
  tree() {
    return this.categories.tree(true);
  }

  @RequirePermissions('catalog:write') @Post()
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(categorySchema)) body: CategoryInput) {
    const c = await this.categories.create(body);
    await this.audit.log({ actorId: u.id, action: 'category.create', entity: 'Category', entityId: c.id, after: c });
    return c;
  }

  @RequirePermissions('catalog:write') @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(categorySchema.partial())) body: Partial<CategoryInput>) {
    const c = await this.categories.update(id, body);
    await this.audit.log({ actorId: u.id, action: 'category.update', entity: 'Category', entityId: id, after: body });
    return c;
  }

  @RequirePermissions('catalog:write') @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.categories.remove(id);
    await this.audit.log({ actorId: u.id, action: 'category.delete', entity: 'Category', entityId: id });
    return { ok: true };
  }
}
