'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { CategoryNode } from '@vyra/shared';
import { categorySchema } from '@vyra/shared';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Skeleton, Textarea, cn } from '@vyra/ui';
import { ChevronRight, FolderTree, Pencil, Plus, Trash2, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { api, errorMessage } from '@/lib/api';
import { applyApiErrors, blankToNull, parseOrSetErrors } from '@/lib/forms';
import { PERM } from '@/lib/permissions';
import { useAuth } from '@/features/auth/auth-context';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/controls';
import { useConfirm } from '@/components/ui/confirm';
import { ErrorState, PageHeader } from '@/components/ui/feedback';
import { formatNumber } from '@/lib/format';
import { CategorySelect } from './category-select';
import { descendantIds, flattenTree, slugify } from './tree';

export function CategoriesScreen() {
  const { can } = useAuth();
  const { data, error, isLoading, mutate } = useApi<CategoryNode[]>('/categories');
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [editing, setEditing] = React.useState<{ node?: CategoryNode; parentId?: string | null } | null>(null);
  const confirm = useConfirm();
  const canWrite = can(PERM.catalogWrite);

  React.useEffect(() => {
    if (data && expanded.size === 0) setExpanded(new Set(data.map((n) => n.id)));
    // expand roots on first load only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const allIds = React.useMemo(() => flattenTree(data ?? []).filter((f) => f.node.children?.length).map((f) => f.id), [data]);
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const onDelete = async (node: CategoryNode) => {
    const ok = await confirm({ title: `Delete “${node.name}”?`, description: 'Categories with products or sub-categories cannot be deleted; deactivate them instead.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    try {
      await api.delete(`/categories/${node.id}`);
      toast.success('Category deleted');
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const renderNode = (node: CategoryNode, depth: number): React.ReactNode => {
    const hasChildren = !!node.children?.length;
    const open = expanded.has(node.id);
    return (
      <li key={node.id} role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-level={depth + 1} aria-selected={false}>
        <div className="group flex items-center gap-2 border-b border-border py-2 pr-3 hover:bg-surface" style={{ paddingLeft: 12 + depth * 22 }}>
          <button
            type="button"
            onClick={() => hasChildren && toggle(node.id)}
            className={cn('flex size-6 items-center justify-center rounded-sm text-muted hover:bg-surface-2', !hasChildren && 'invisible')}
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
          >
            <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{node.name}</span>
              <code className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-muted">{node.code}</code>
              {!node.isActive && <Badge tone="warning">Inactive</Badge>}
            </div>
            <p className="truncate text-xs text-muted">/{node.slug}</p>
          </div>
          <span className="tabular hidden w-24 text-right text-xs text-muted sm:block">{node.productCount !== undefined ? `${formatNumber(node.productCount)} products` : ''}</span>
          <span className="tabular hidden w-14 text-right text-xs text-subtle sm:block">#{node.sortOrder}</span>
          {canWrite && (
            <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <Button variant="ghost" size="sm" onClick={() => setEditing({ parentId: node.id })} aria-label={`Add sub-category to ${node.name}`}><Plus /></Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing({ node })} aria-label={`Edit ${node.name}`}><Pencil /></Button>
              <Button variant="ghost" size="sm" onClick={() => void onDelete(node)} aria-label={`Delete ${node.name}`}><Trash2 /></Button>
            </div>
          )}
        </div>
        {hasChildren && open && <ul role="group">{[...node.children].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Categories"
        description="The category tree drives storefront navigation and SKU codes."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setExpanded(expanded.size >= allIds.length ? new Set() : new Set(allIds))}>
              {expanded.size >= allIds.length ? <><ChevronsDownUp /> Collapse all</> : <><ChevronsUpDown /> Expand all</>}
            </Button>
            {canWrite && <Button size="sm" onClick={() => setEditing({ parentId: null })}><Plus /> New category</Button>}
          </>
        }
      />
      {error && !data ? <ErrorState error={error} onRetry={() => void mutate()} /> : (
        <Card className="overflow-hidden">
          {isLoading && !data ? (
            <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : !data?.length ? (
            <EmptyState icon={<FolderTree />} title="No categories yet" description="Create top-level categories such as Men, Women and Kids." action={canWrite ? <Button size="sm" onClick={() => setEditing({ parentId: null })}><Plus /> New category</Button> : undefined} />
          ) : (
            <ul role="tree" aria-label="Categories" className="-mb-px">{[...data].sort((a, b) => a.sortOrder - b.sortOrder).map((n) => renderNode(n, 0))}</ul>
          )}
        </Card>
      )}
      {editing && (
        <CategoryDialog
          tree={data ?? []}
          node={editing.node}
          parentId={editing.parentId ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void mutate(); }}
        />
      )}
    </>
  );
}

interface CategoryValues {
  name: string; slug: string; code: string; parentId: string; description: string; imageUrl: string; bannerUrl: string;
  seoTitle: string; seoDescription: string; sortOrder: string; isActive: boolean;
}

function CategoryDialog({ tree, node, parentId, onClose, onSaved }: { tree: CategoryNode[]; node?: CategoryNode; parentId: string | null; onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit, setError, setValue, watch, formState: { errors, isSubmitting, dirtyFields } } = useForm<CategoryValues>({
    defaultValues: {
      name: node?.name ?? '', slug: node?.slug ?? '', code: node?.code ?? '', parentId: node ? node.parentId ?? '' : parentId ?? '',
      description: node?.description ?? '', imageUrl: node?.imageUrl ?? '', bannerUrl: node?.bannerUrl ?? '', seoTitle: node?.seoTitle ?? '',
      seoDescription: node?.seoDescription ?? '', sortOrder: String(node?.sortOrder ?? 0), isActive: node?.isActive ?? true,
    },
  });
  const exclude = React.useMemo(() => (node ? descendantIds(node) : undefined), [node]);
  const name = watch('name');
  React.useEffect(() => {
    if (!node && !dirtyFields.slug) setValue('slug', slugify(name));
  }, [name, node, dirtyFields.slug, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    const parsed = parseOrSetErrors(categorySchema, blankToNull({ ...values, sortOrder: values.sortOrder }), setError);
    if (!parsed) return;
    try {
      if (node) await api.patch(`/categories/${node.id}`, parsed);
      else await api.post('/categories', parsed);
      toast.success(node ? 'Category updated' : 'Category created');
      onSaved();
    } catch (err) {
      if (!applyApiErrors(err, setError)) toast.error(errorMessage(err));
    }
  });

  const isActive = watch('isActive');
  const err = (k: keyof CategoryValues) => errors[k]?.message;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={node ? `Edit ${node.name}` : 'New category'}
      size="lg"
      modalLock
      footer={<><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" onClick={() => void onSubmit()} loading={isSubmitting}>{node ? 'Save changes' : 'Create category'}</Button></>}
    >
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {errors.root?.server && <Alert tone="danger" className="sm:col-span-2">{errors.root.server.message}</Alert>}
        <Field label="Name" htmlFor="c-name" error={err('name')}><Input id="c-name" invalid={!!errors.name} {...register('name')} /></Field>
        <Field label="Slug" htmlFor="c-slug" error={err('slug')} hint="URL segment"><Input id="c-slug" invalid={!!errors.slug} {...register('slug')} /></Field>
        <Field label="Code" htmlFor="c-code" error={err('code')} hint="3 letters, used in SKUs. Avoid changing after products exist.">
          <Input id="c-code" maxLength={3} className="uppercase" invalid={!!errors.code} {...register('code')} />
        </Field>
        <Field label="Parent" htmlFor="c-parent" error={err('parentId')}>
          <CategorySelect id="c-parent" tree={tree} exclude={exclude} placeholder="— Top level —" {...register('parentId')} />
        </Field>
        <Field label="Description" htmlFor="c-desc" error={err('description')} className="sm:col-span-2"><Textarea id="c-desc" rows={3} {...register('description')} /></Field>
        <Field label="Image URL" htmlFor="c-img" error={err('imageUrl')}><Input id="c-img" type="url" placeholder="https://…" invalid={!!errors.imageUrl} {...register('imageUrl')} /></Field>
        <Field label="Banner URL" htmlFor="c-banner" error={err('bannerUrl')}><Input id="c-banner" type="url" placeholder="https://…" invalid={!!errors.bannerUrl} {...register('bannerUrl')} /></Field>
        <Field label="SEO title" htmlFor="c-seot" error={err('seoTitle')} hint="Max 70 characters"><Input id="c-seot" maxLength={70} {...register('seoTitle')} /></Field>
        <Field label="Sort order" htmlFor="c-sort" error={err('sortOrder')}><Input id="c-sort" type="number" step={1} {...register('sortOrder')} /></Field>
        <Field label="SEO description" htmlFor="c-seod" error={err('seoDescription')} hint="Max 170 characters" className="sm:col-span-2"><Textarea id="c-seod" rows={2} maxLength={170} {...register('seoDescription')} /></Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Switch id="c-active" checked={isActive} onCheckedChange={(v) => setValue('isActive', v, { shouldDirty: true })} />
          <label htmlFor="c-active" className="text-sm">Active (visible on the storefront)</label>
        </div>
      </form>
    </Dialog>
  );
}
