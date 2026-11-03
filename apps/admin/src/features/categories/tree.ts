import type { CategoryNode } from '@vyra/shared';

export interface FlatCategory { id: string; name: string; depth: number; path: string; node: CategoryNode }

export function flattenTree(nodes: CategoryNode[], depth = 0, prefix = ''): FlatCategory[] {
  const sorted = [...nodes].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return sorted.flatMap((n) => {
    const path = prefix ? `${prefix} › ${n.name}` : n.name;
    return [{ id: n.id, name: n.name, depth, path, node: n }, ...flattenTree(n.children ?? [], depth + 1, path)];
  });
}

/** Ids of a node and all of its descendants (a category can't be moved under itself). */
export function descendantIds(node: CategoryNode): Set<string> {
  const out = new Set<string>([node.id]);
  const walk = (n: CategoryNode) => n.children?.forEach((c) => { out.add(c.id); walk(c); });
  walk(node);
  return out;
}

export function slugify(input: string): string {
  return input.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
