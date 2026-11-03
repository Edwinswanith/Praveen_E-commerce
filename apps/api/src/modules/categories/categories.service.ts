import { Injectable } from '@nestjs/common';
import type { Category } from '@prisma/client';
import type { CategoryInput, CategoryNode } from '@vyra/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { badRequest, conflict, notFound } from '../../common/http/errors';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async all(includeInactive: boolean): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async tree(includeInactive = false): Promise<CategoryNode[]> {
    const cats = await this.all(includeInactive);
    const counts = await this.prisma.product.groupBy({ by: ['categoryId'], where: { status: 'ACTIVE', deletedAt: null }, _count: true });
    const countMap = new Map(counts.map((c) => [c.categoryId, c._count]));
    const nodes = new Map<string, CategoryNode>();
    for (const c of cats) {
      nodes.set(c.id, {
        id: c.id, name: c.name, slug: c.slug, code: c.code, parentId: c.parentId, description: c.description, imageUrl: c.imageUrl,
        bannerUrl: c.bannerUrl, seoTitle: c.seoTitle, seoDescription: c.seoDescription, isActive: c.isActive, sortOrder: c.sortOrder,
        productCount: countMap.get(c.id) ?? 0, children: [],
      });
    }
    const roots: CategoryNode[] = [];
    for (const n of nodes.values()) {
      const parent = n.parentId ? nodes.get(n.parentId) : undefined;
      if (parent) parent.children.push(n);
      else if (!n.parentId) roots.push(n);
    }
    // Roll descendant counts up so "Men" shows the total of its subcategories.
    const roll = (n: CategoryNode): number => (n.productCount = (n.productCount ?? 0) + n.children.reduce((s, c) => s + roll(c), 0));
    roots.forEach(roll);
    return roots;
  }

  /** The category and all its descendants' ids (for listing "Men" incl. subcategories). */
  async descendantIds(rootId: string): Promise<string[]> {
    const cats = await this.all(true);
    const ids = [rootId];
    for (let i = 0; i < ids.length; i++) for (const c of cats) if (c.parentId === ids[i]) ids.push(c.id);
    return ids;
  }

  async bySlug(slug: string) {
    const cat = await this.prisma.category.findFirst({ where: { slug, isActive: true, deletedAt: null } });
    if (!cat) throw notFound('Category');
    const tree = await this.tree();
    const find = (nodes: CategoryNode[]): CategoryNode | undefined => nodes.reduce<CategoryNode | undefined>((f, n) => f ?? (n.id === cat.id ? n : find(n.children)), undefined);
    const node = find(tree)!;
    return { ...node, path: await this.path(cat.id) };
  }

  async path(categoryId: string): Promise<{ name: string; slug: string }[]> {
    const all = await this.all(true);
    const byId = new Map(all.map((c) => [c.id, c]));
    const out: { name: string; slug: string }[] = [];
    let cur = byId.get(categoryId);
    while (cur) {
      out.unshift({ name: cur.name, slug: cur.slug });
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  }

  async create(input: CategoryInput) {
    if (input.parentId) await this.assertExists(input.parentId);
    return this.prisma.category.create({ data: input });
  }

  async update(id: string, input: Partial<CategoryInput>) {
    await this.assertExists(id);
    if (input.parentId) {
      if (input.parentId === id) throw badRequest('A category cannot be its own parent');
      const desc = await this.descendantIds(id);
      if (desc.includes(input.parentId)) throw badRequest('Cannot move a category under its own descendant');
    }
    return this.prisma.category.update({ where: { id }, data: input });
  }

  async remove(id: string) {
    await this.assertExists(id);
    const [products, children] = await Promise.all([
      this.prisma.product.count({ where: { categoryId: id, deletedAt: null } }),
      this.prisma.category.count({ where: { parentId: id, deletedAt: null } }),
    ]);
    if (products || children) throw conflict('Move its products and subcategories before deleting this category');
    await this.prisma.category.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, slug: `deleted-${Date.now()}-${id}` } });
  }

  private async assertExists(id: string) {
    const c = await this.prisma.category.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw notFound('Category');
    return c;
  }
}
