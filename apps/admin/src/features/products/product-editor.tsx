'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { AdminProductDetailDto, CategoryNode, Gender, ProductStatus } from '@vyra/shared';
import { productSchema, productUpdateSchema } from '@vyra/shared';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton, Textarea } from '@vyra/ui';
import { ArrowLeft, Archive, ExternalLink, Eye, EyeOff, RefreshCw, Sparkles } from 'lucide-react';
import { useApi } from '@/lib/swr';
import { api, ApiError, errorMessage } from '@/lib/api';
import { blankToNull } from '@/lib/forms';
import { useAuth } from '@/features/auth/auth-context';
import { PERM } from '@/lib/permissions';
import { PRODUCT_STATUS_TONE } from '@/lib/status';
import { ErrorState, PageHeader, StatusBadge } from '@/components/ui/feedback';
import { Select, Switch } from '@/components/ui/controls';
import { useConfirm } from '@/components/ui/confirm';
import { CategorySelect } from '@/features/categories/category-select';
import { slugify } from '@/features/categories/tree';
import { VariantMatrixEditor, type VariantErrors } from './variant-matrix-editor';
import { rowsFromVariants, toVariantPayload, type MatrixRow } from './variant-matrix';
import { SizeChartEditor, sizeChartFromRecord, sizeChartToRecord, type SizeChartState } from './size-chart-editor';
import { MediaManager } from './media-manager';

const STOREFRONT = (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const ATTRIBUTES = [
  { key: 'fabric', label: 'Fabric', placeholder: '100% cotton' },
  { key: 'fit', label: 'Fit', placeholder: 'Regular' },
  { key: 'occasion', label: 'Occasion', placeholder: 'Casual' },
  { key: 'pattern', label: 'Pattern', placeholder: 'Solid' },
  { key: 'sleeve', label: 'Sleeve', placeholder: 'Half sleeve' },
  { key: 'neck', label: 'Neck', placeholder: 'Round neck' },
  { key: 'season', label: 'Season', placeholder: 'All season' },
] as const;
type AttrKey = (typeof ATTRIBUTES)[number]['key'] | 'care';

interface ProductValues {
  name: string; slug: string; description: string; brand: string; gender: Gender | ''; categoryId: string; hsnCode: string;
  tags: string; isFeatured: boolean; seoTitle: string; seoDescription: string;
  attributes: Record<AttrKey, string>;
}

const emptyAttrs = (): Record<AttrKey, string> => ({ fabric: '', fit: '', occasion: '', pattern: '', sleeve: '', neck: '', season: '', care: '' });

function valuesFrom(p?: AdminProductDetailDto): ProductValues {
  const attrs = emptyAttrs();
  if (p) for (const k of Object.keys(attrs) as AttrKey[]) attrs[k] = p.attributes?.[k] ?? '';
  return {
    name: p?.name ?? '', slug: p?.slug ?? '', description: p?.description ?? '', brand: p?.brand ?? 'VYRA', gender: p?.gender ?? '',
    categoryId: p?.categoryId ?? p?.category.id ?? '', hsnCode: p?.hsnCode ?? '6109', tags: (p?.tags ?? []).join(', '),
    isFeatured: p?.isFeatured ?? false, seoTitle: p?.seoTitle ?? '', seoDescription: p?.seoDescription ?? '', attributes: attrs,
  };
}

export function ProductEditor({ productId }: { productId?: string }) {
  const { data, error, isLoading, mutate } = useApi<AdminProductDetailDto>(productId ? `/products/${productId}` : null);
  const [version, setVersion] = React.useState(0);
  if (productId && error && !data) return (<><BackLink /><ErrorState error={error} onRetry={() => void mutate()} /></>);
  if (productId && (isLoading || !data)) return <EditorSkeleton />;
  return (
    <ProductForm
      key={`${productId ?? 'new'}-${version}`}
      product={data}
      onSaved={async () => { await mutate(); setVersion((v) => v + 1); }}
      onMediaChanged={() => void mutate()}
    />
  );
}

function BackLink() {
  return <Link href="/products" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> Products</Link>;
}

function EditorSkeleton() {
  return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64" /><Skeleton className="h-96" /></div>;
}

function ProductForm({ product, onSaved, onMediaChanged }: { product?: AdminProductDetailDto; onSaved: () => Promise<void>; onMediaChanged: () => void }) {
  const router = useRouter();
  const { can } = useAuth();
  const confirm = useConfirm();
  const canWrite = can(PERM.catalogWrite);
  const { data: categories } = useApi<CategoryNode[]>('/categories');
  const { register, handleSubmit, setError, setValue, watch, clearErrors, formState: { errors, isSubmitting, dirtyFields, isDirty } } = useForm<ProductValues>({ defaultValues: valuesFrom(product) });
  const [rows, setRows] = React.useState<MatrixRow[]>(() => rowsFromVariants(product?.variants ?? []));
  const [rowsDirty, setRowsDirty] = React.useState(false);
  const [sizeChart, setSizeChart] = React.useState<SizeChartState>(() => sizeChartFromRecord(product?.sizeChart));
  const [variantErrors, setVariantErrors] = React.useState<VariantErrors>({});
  const [generalErrors, setGeneralErrors] = React.useState<string[]>([]);
  const [statusPending, setStatusPending] = React.useState(false);

  const name = watch('name');
  React.useEffect(() => {
    if (!product && !dirtyFields.slug) setValue('slug', slugify(name));
  }, [name, product, dirtyFields.slug, setValue]);

  const setVariantRows = (r: MatrixRow[]) => { setRows(r); setRowsDirty(true); setVariantErrors({}); };
  const payloadRows = rows.filter((r) => r.id || r.isActive);

  const applyIssues = (issues: { path: (string | number)[]; message: string }[]) => {
    const ve: VariantErrors = {};
    const general: string[] = [];
    let focused = false;
    for (const issue of issues) {
      const [head, idx, field] = issue.path;
      if (head === 'variants') {
        if (typeof idx === 'number' || (typeof idx === 'string' && /^\d+$/.test(idx))) {
          const row = payloadRows[Number(idx)];
          const ri = row ? rows.indexOf(row) : -1;
          if (ri >= 0) ve[ri] = { ...ve[ri], [String(field ?? 'root')]: issue.message };
        } else general.push(`Variants: ${issue.message}`);
        continue;
      }
      if (head === 'sizeChart') { general.push(`Size chart: ${issue.message}`); continue; }
      const name = issue.path.join('.');
      if (['name', 'slug', 'description', 'brand', 'gender', 'categoryId', 'hsnCode', 'seoTitle', 'seoDescription', 'isFeatured'].includes(String(head)) || String(head) === 'attributes') {
        setError(name as keyof ProductValues, { type: 'validate', message: issue.message }, { shouldFocus: !focused });
        focused = true;
      } else if (head === 'tags') {
        setError('tags', { type: 'validate', message: issue.message });
      } else general.push(issue.message);
    }
    if (Object.keys(ve).length && !general.length) general.push('Some variants have errors — see the highlighted cells.');
    setVariantErrors(ve);
    setGeneralErrors(general);
  };

  const onSubmit = handleSubmit(async (values) => {
    clearErrors();
    setGeneralErrors([]);
    setVariantErrors({});
    const attributes = Object.fromEntries(Object.entries(values.attributes).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
    const base = {
      name: values.name,
      slug: values.slug || undefined,
      description: values.description,
      brand: values.brand,
      gender: values.gender || undefined,
      categoryId: values.categoryId,
      hsnCode: values.hsnCode,
      tags: values.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      attributes,
      sizeChart: sizeChartToRecord(sizeChart),
      isFeatured: values.isFeatured,
      seoTitle: values.seoTitle,
      seoDescription: values.seoDescription,
      variants: toVariantPayload(rows),
    };
    const cleaned = blankToNull(base);
    const schema = product ? productUpdateSchema : productSchema;
    const parsed = schema.safeParse(cleaned);
    if (!parsed.success) {
      applyIssues(parsed.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })));
      toast.error('Please fix the highlighted fields');
      return;
    }
    try {
      if (product) {
        await api.patch<AdminProductDetailDto>(`/products/${product.id}`, parsed.data);
        toast.success('Product saved');
        await onSaved();
      } else {
        const created = await api.post<AdminProductDetailDto>('/products', parsed.data);
        toast.success('Product created — now add images');
        router.replace(`/products/${created.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        applyIssues(Object.entries(err.fieldErrors).flatMap(([k, msgs]) => (msgs ?? []).map((m) => ({ path: k.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)), message: m }))));
        if (err.formErrors.length) setGeneralErrors((g) => [...g, ...err.formErrors]);
      } else {
        setGeneralErrors([errorMessage(err)]);
      }
      toast.error(errorMessage(err));
    }
  });

  const changeStatus = async (status: ProductStatus) => {
    if (!product) return;
    if (isDirty || rowsDirty) {
      const ok = await confirm({ title: 'You have unsaved changes', description: 'Changing the status will not save your edits. Continue?', confirmLabel: 'Continue' });
      if (!ok) return;
    }
    if (status === 'ARCHIVED' && !(await confirm({ title: 'Archive this product?', description: 'It will be hidden from the storefront and search.', confirmLabel: 'Archive', destructive: true }))) return;
    setStatusPending(true);
    try {
      await api.post(`/products/${product.id}/status`, { status });
      toast.success(status === 'ACTIVE' ? 'Published' : status === 'DRAFT' ? 'Moved to draft' : 'Archived');
      onMediaChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStatusPending(false);
    }
  };

  const reindex = async () => {
    if (!product) return;
    try {
      await api.post('/ai/reindex', { productIds: [product.id] });
      toast.success('Re-index queued');
      onMediaChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const isFeatured = watch('isFeatured');
  const colourNames = Array.from(new Set(rows.filter((r) => r.isActive).map((r) => r.color)));
  const variantSizes = Array.from(new Set(rows.filter((r) => r.isActive).map((r) => r.size)));
  const e = errors;

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader
        back={<BackLink />}
        title={product ? product.name : 'New product'}
        description={product ? (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge value={product.status} tone={PRODUCT_STATUS_TONE[product.status]} />
            <EmbeddingChip embedding={product.embedding} />
            <span className="text-xs">/{product.slug}</span>
          </span>
        ) : 'Fill in the details, then generate variants. Images can be added after the first save.'}
        actions={
          <>
            {product && (
              <Button asChild variant="ghost" size="sm">
                <a href={`${STOREFRONT}/p/${product.slug}`} target="_blank" rel="noreferrer"><ExternalLink /> Preview</a>
              </Button>
            )}
            {product && canWrite && <Button type="button" variant="ghost" size="sm" onClick={() => void reindex()}><RefreshCw /> Re-index AI</Button>}
            {product && can(PERM.catalogPublish) && (
              <>
                {product.status !== 'ACTIVE' && <Button type="button" variant="outline" size="sm" disabled={statusPending} onClick={() => void changeStatus('ACTIVE')}><Eye /> Publish</Button>}
                {product.status === 'ACTIVE' && <Button type="button" variant="outline" size="sm" disabled={statusPending} onClick={() => void changeStatus('DRAFT')}><EyeOff /> Unpublish</Button>}
                {product.status !== 'ARCHIVED' && <Button type="button" variant="outline" size="sm" disabled={statusPending} onClick={() => void changeStatus('ARCHIVED')}><Archive /> Archive</Button>}
              </>
            )}
            {canWrite && <Button type="submit" size="sm" loading={isSubmitting}>{product ? 'Save changes' : 'Create product'}</Button>}
          </>
        }
      />

      {generalErrors.length > 0 && (
        <Alert tone="danger" title="Could not save" className="mb-4">
          <ul className="list-disc pl-4">{generalErrors.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </Alert>
      )}

      <fieldset disabled={!canWrite} className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="p-name" error={e.name?.message} className="sm:col-span-2"><Input id="p-name" invalid={!!e.name} {...register('name')} /></Field>
              <Field label="Slug" htmlFor="p-slug" error={e.slug?.message} hint="Leave blank to generate from name"><Input id="p-slug" invalid={!!e.slug} {...register('slug')} /></Field>
              <Field label="Brand" htmlFor="p-brand" error={e.brand?.message}><Input id="p-brand" invalid={!!e.brand} {...register('brand')} /></Field>
              <Field label="Description" htmlFor="p-desc" error={e.description?.message} className="sm:col-span-2"><Textarea id="p-desc" rows={5} invalid={!!e.description} {...register('description')} /></Field>
              <Field label="Category" htmlFor="p-cat" error={e.categoryId?.message}><CategorySelect id="p-cat" tree={categories} invalid={!!e.categoryId} {...register('categoryId')} /></Field>
              <Field label="Gender" htmlFor="p-gender" error={e.gender?.message}>
                <Select id="p-gender" invalid={!!e.gender} {...register('gender')}>
                  <option value="">Select</option>
                  <option value="WOMEN">Women</option><option value="MEN">Men</option><option value="KIDS">Kids</option><option value="UNISEX">Unisex</option>
                </Select>
              </Field>
              <Field label="Tags" htmlFor="p-tags" error={e.tags?.message} hint="Comma separated, e.g. summer, linen, festive"><Input id="p-tags" {...register('tags')} /></Field>
              <Field label="HSN code" htmlFor="p-hsn" error={e.hsnCode?.message} hint="Used on GST invoices"><Input id="p-hsn" inputMode="numeric" invalid={!!e.hsnCode} {...register('hsnCode')} /></Field>
              <div className="flex items-center gap-3 sm:col-span-2">
                <Switch id="p-featured" checked={isFeatured} onCheckedChange={(v) => setValue('isFeatured', v, { shouldDirty: true })} />
                <label htmlFor="p-featured" className="text-sm">Featured on the storefront home page</label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Variants</CardTitle><span className="text-xs text-muted">Colours × sizes</span></CardHeader>
            <CardContent><VariantMatrixEditor rows={rows} onChange={setVariantRows} errors={variantErrors} /></CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Media</CardTitle></CardHeader>
            <CardContent>
              {product ? (
                <MediaManager productId={product.id} images={product.images} videos={product.videos} colours={colourNames} onChanged={onMediaChanged} canWrite={canWrite} />
              ) : (
                <p className="text-sm text-muted">Save the product first, then upload images and videos here.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Size chart</CardTitle></CardHeader>
            <CardContent><SizeChartEditor value={sizeChart} onChange={setSizeChart} suggestedSizes={variantSizes} /></CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Attributes</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {ATTRIBUTES.map((a) => (
                <Field key={a.key} label={a.label} htmlFor={`p-attr-${a.key}`} error={e.attributes?.[a.key]?.message}>
                  <Input id={`p-attr-${a.key}`} placeholder={a.placeholder} {...register(`attributes.${a.key}`)} />
                </Field>
              ))}
              <Field label="Care" htmlFor="p-attr-care" error={e.attributes?.care?.message}><Textarea id="p-attr-care" rows={2} placeholder="Machine wash cold" {...register('attributes.care')} /></Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Search engine listing</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <Field label="SEO title" htmlFor="p-seot" error={e.seoTitle?.message} hint={`${watch('seoTitle').length}/70`}><Input id="p-seot" maxLength={70} {...register('seoTitle')} /></Field>
              <Field label="SEO description" htmlFor="p-seod" error={e.seoDescription?.message} hint={`${watch('seoDescription').length}/170`}><Textarea id="p-seod" rows={3} maxLength={170} {...register('seoDescription')} /></Field>
            </CardContent>
          </Card>
          {product && (
            <Card>
              <CardHeader><CardTitle>AI search index</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted">Status</span><EmbeddingChip embedding={product.embedding} /></div>
                <div className="flex justify-between"><span className="text-muted">Text embedding</span><span>{product.embedding.text ? 'Indexed' : 'Missing'}</span></div>
                <div className="flex justify-between"><span className="text-muted">Image embeddings</span><span className="tabular">{product.embedding.images} / {product.images.length}</span></div>
                <div className="flex justify-between"><span className="text-muted">Model</span><span className="truncate pl-4 text-xs">{product.embedding.model ?? '—'}</span></div>
              </CardContent>
            </Card>
          )}
        </div>
      </fieldset>
    </form>
  );
}

export function EmbeddingChip({ embedding }: { embedding: AdminProductDetailDto['embedding'] }) {
  const s = (embedding.status ?? '').toUpperCase();
  const tone = s === 'COMPLETED' ? 'success' : s === 'FAILED' ? 'danger' : s === 'PROCESSING' || s === 'PENDING' ? 'info' : 'neutral';
  const label = s === 'COMPLETED' ? 'AI indexed' : s === 'FAILED' ? 'AI index failed' : s === 'PROCESSING' ? 'AI indexing' : s === 'PENDING' ? 'AI queued' : 'Not indexed';
  return <Badge tone={tone}><Sparkles className="size-3" aria-hidden />{label}</Badge>;
}
