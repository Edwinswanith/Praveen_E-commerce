'use client';
import * as React from 'react';
import type { CategoryNode } from '@vyra/shared';
import { Select } from '@/components/ui/controls';
import { flattenTree } from './tree';

export const CategorySelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & {
  tree: CategoryNode[] | undefined; placeholder?: string; exclude?: Set<string>; invalid?: boolean;
}>(({ tree, placeholder = 'Select a category', exclude, ...props }, ref) => {
  const flat = React.useMemo(() => flattenTree(tree ?? []), [tree]);
  return (
    <Select ref={ref} {...props}>
      <option value="">{placeholder}</option>
      {flat.filter((c) => !exclude?.has(c.id)).map((c) => (
        <option key={c.id} value={c.id}>
          {'  '.repeat(c.depth)}{c.depth ? '└ ' : ''}{c.name}{c.node.isActive ? '' : ' (inactive)'}
        </option>
      ))}
    </Select>
  );
});
CategorySelect.displayName = 'CategorySelect';
