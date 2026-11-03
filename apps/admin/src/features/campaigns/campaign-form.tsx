'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { campaignSchema, validateCampaignWindow, type CampaignAdminDto } from '@vyra/shared';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Textarea } from '@vyra/ui';
import { ArrowLeft, Info, Lock } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { istInputToIso, isoToIstInput } from '@/lib/ist';
import { slugify } from '@/features/categories/tree';
import { PageHeader } from '@/components/ui/feedback';
import { hasStartedSelling } from './campaign-rules';

export interface CampaignFormValues {
  name: string; slug: string; festival: string; edition: string; description: string; priority: string;
  teaserStartsAt: string; earlyAccessStartsAt: string; startsAt: string; endsAt: string;
  budget: string; bannerTitle: string; bannerSubtitle: string; bannerImageUrl: string; themeColor: string;
}

export const WINDOW_FIELDS = ['teaserStartsAt', 'earlyAccessStartsAt', 'startsAt', 'endsAt'] as const;
type WindowField = (typeof WINDOW_FIELDS)[number];

export function campaignToValues(c?: CampaignAdminDto): CampaignFormValues {
  return {
    name: c?.name ?? '', slug: c?.slug ?? '', festival: c?.festival ?? '', edition: c?.edition ?? '', description: c?.description ?? '',
    priority: String(c?.priority ?? 0),
    teaserStartsAt: isoToIstInput(c?.teaserStartsAt), earlyAccessStartsAt: isoToIstInput(c?.earlyAccessStartsAt),
    startsAt: isoToIstInput(c?.startsAt), endsAt: isoToIstInput(c?.endsAt),
    budget: c?.budget != null ? String(c.budget) : '',
    bannerTitle: c?.banner.title ?? '', bannerSubtitle: c?.banner.subtitle ?? '', bannerImageUrl: c?.banner.imageUrl ?? '', themeColor: c?.banner.themeColor ?? '',
  };
}

const blank = (v: string) => (v.trim() === '' ? null : v.trim());

/** Phase-order problems, computed live from the IST inputs (same rules as the API). */
export function windowProblems(v: Pick<CampaignFormValues, WindowField>): Partial<Record<WindowField, string>> {
  const startsAt = istInputToIso(v.startsAt), endsAt = istInputToIso(v.endsAt);
  if (!startsAt || !endsAt) return {};
  const teaser = istInputToIso(v.teaserStartsAt), early = istInputToIso(v.earlyAccessStartsAt);
  const out: Partial<Record<WindowField, string>> = {};
  for (const p of validateCampaignWindow({
    startsAt: new Date(startsAt), endsAt: new Date(endsAt),
    teaserStartsAt: teaser ? new Date(teaser) : null, earlyAccessStartsAt: early ? new Date(early) : null,
  })) {
    const f = p.field as WindowField;
    if (!out[f]) out[f] = p.message;
  }
  return out;
}

export type CampaignPayload = Record<string, unknown>;

/**
 * Validates the form and builds the request body. On edit, window fields are only
 * sent when changed (inputs are minute precision, the stored instant may not be),
 * and fields the API refuses to change are left out.
 */
export function buildCampaignPayload(v: CampaignFormValues, original?: CampaignAdminDto, now = new Date()):
  { ok: true; payload: CampaignPayload } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const isoOf = (f: WindowField, required: boolean) => {
    const raw = v[f].trim();
    if (!raw) { if (required) errors[f] = 'Required'; return null; }
    const iso = istInputToIso(raw);
    if (!iso) errors[f] = 'Enter a valid date and time';
    return iso;
  };
  const times = {
    teaserStartsAt: isoOf('teaserStartsAt', false), earlyAccessStartsAt: isoOf('earlyAccessStartsAt', false),
    startsAt: isoOf('startsAt', true), endsAt: isoOf('endsAt', true),
  };
  Object.assign(errors, Object.fromEntries(Object.entries(windowProblems(v)).filter(([k]) => !errors[k])));

  const body = {
    name: v.name, slug: v.slug, festival: blank(v.festival), edition: blank(v.edition), description: blank(v.description),
    priority: v.priority.trim() === '' ? 0 : v.priority, ...times,
    budget: blank(v.budget), bannerTitle: blank(v.bannerTitle), bannerSubtitle: blank(v.bannerSubtitle), bannerImageUrl: blank(v.bannerImageUrl),
    themeColor: blank(v.themeColor),
  };
  const parsed = campaignSchema.safeParse(body);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const k = issue.path.map(String).join('.') || 'root';
      if (!errors[k]) errors[k] = issue.message;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const payload: CampaignPayload = { ...body };
  if (original) {
    const orig = campaignToValues(original);
    for (const f of WINDOW_FIELDS) if (v[f].trim() === orig[f]) delete payload[f];
    if (original.publishedAt || v.slug === original.slug) delete payload.slug;
    if (hasStartedSelling(original, now)) { delete payload.startsAt; delete payload.earlyAccessStartsAt; delete payload.endsAt; }
    // PATCH uses campaignSchema.partial(), whose `priority` default would reset it to 0 if omitted, so it is always sent.
  }
  return { ok: true, payload };
}

const FIELD_NAMES = Object.keys(campaignToValues()) as (keyof CampaignFormValues)[];

export function CampaignForm({ campaign, onSaved }: { campaign?: CampaignAdminDto; onSaved?: (c: CampaignAdminDto) => void }) {
  const router = useRouter();
  const { register, handleSubmit, setError, watch, setValue, formState: { errors, isSubmitting, dirtyFields } } = useForm<CampaignFormValues>({ defaultValues: campaignToValues(campaign) });
  const started = campaign ? hasStartedSelling(campaign) : false;
  const slugLocked = !!campaign?.publishedAt;
  const live = windowProblems(watch());
  const themeColor = watch('themeColor');

  const submit = handleSubmit(async (v) => {
    const r = buildCampaignPayload(v, campaign);
    if (!r.ok) {
      let first = true;
      for (const [k, message] of Object.entries(r.errors)) {
        setError((FIELD_NAMES as string[]).includes(k) ? (k as keyof CampaignFormValues) : 'root.server', { type: 'validate', message }, { shouldFocus: first });
        first = false;
      }
      return;
    }
    try {
      const saved = campaign
        ? await api.patch<CampaignAdminDto>(`/campaigns/${campaign.id}`, r.payload)
        : await api.post<CampaignAdminDto>('/campaigns', r.payload);
      toast.success(campaign ? 'Campaign saved' : 'Draft campaign created');
      if (onSaved) onSaved(saved);
      else router.push(`/campaigns/${saved.id}`);
    } catch (err) {
      const fe = err instanceof ApiError ? err.fieldErrors : null;
      let applied = false;
      if (fe) for (const [k, msgs] of Object.entries(fe)) {
        if (msgs?.[0] && (FIELD_NAMES as string[]).includes(k)) { setError(k as keyof CampaignFormValues, { type: 'server', message: msgs[0] }); applied = true; }
      }
      if (!applied) setError('root.server', { type: 'server', message: errorMessage(err) });
    }
  });

  const timeField = (f: WindowField, label: string, hint: string, disabled: boolean) => (
    <Field label={label} htmlFor={`cf-${f}`} error={errors[f]?.message ?? live[f]} hint={hint}>
      <Input id={`cf-${f}`} type="datetime-local" disabled={disabled} invalid={!!(errors[f] || live[f])} aria-describedby={errors[f] || live[f] ? `cf-${f}-error` : undefined} {...register(f)} />
    </Field>
  );

  const back = <Link href={campaign ? `/campaigns/${campaign.id}` : '/campaigns'} className="mb-2 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-muted hover:text-fg sm:min-h-0"><ArrowLeft className="size-3.5" /> {campaign ? campaign.name : 'Campaigns'}</Link>;

  return (
    <>
      <PageHeader back={back} title={campaign ? `Edit ${campaign.name}` : 'New campaign'} description={campaign ? undefined : 'Campaigns start as drafts. Add prices or bundle offers, check the checklist, then publish.'} />
      <form onSubmit={submit} noValidate className="space-y-5 pb-24">
        {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}
        <Card>
          <CardHeader><CardTitle>Basics</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="cf-name" error={errors.name?.message}>
              <Input id="cf-name" invalid={!!errors.name} {...register('name', {
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => { if (!campaign && !dirtyFields.slug) setValue('slug', slugify(e.target.value)); },
              })} />
            </Field>
            <Field label="URL slug" htmlFor="cf-slug" error={errors.slug?.message} hint={slugLocked ? 'Locked after publishing: links are already shared' : 'Shown at /sale/<slug>. Lowercase letters, numbers, hyphens'}>
              <Input id="cf-slug" className="font-mono" disabled={slugLocked} invalid={!!errors.slug} {...register('slug')} />
            </Field>
            <Field label="Festival" htmlFor="cf-festival" error={errors.festival?.message} hint="e.g. Diwali, Eid, Onam"><Input id="cf-festival" {...register('festival')} /></Field>
            <Field label="Edition" htmlFor="cf-edition" error={errors.edition?.message} hint="e.g. 2026"><Input id="cf-edition" {...register('edition')} /></Field>
            <Field label="Description" htmlFor="cf-desc" error={errors.description?.message} className="sm:col-span-2"><Textarea id="cf-desc" rows={3} maxLength={1000} {...register('description')} /></Field>
            <Field label="Priority" htmlFor="cf-priority" error={errors.priority?.message} hint="0 to 100. When two sales price the same item equally, the higher priority is shown">
              <Input id="cf-priority" type="number" inputMode="numeric" min={0} max={100} step={1} className="tabular" invalid={!!errors.priority} {...register('priority')} />
            </Field>
            <Field label="Discount budget ₹" htmlFor="cf-budget" error={errors.budget?.message} hint="Optional. The sale pauses itself when discounts reach this amount">
              <Input id="cf-budget" type="number" inputMode="decimal" min={0} step="0.01" className="tabular" invalid={!!errors.budget} {...register('budget')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Schedule (IST)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="flex items-start gap-2 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />All times are India Standard Time (Asia/Kolkata), whatever your device timezone is. Teaser and early access are optional.</p>
            {started && (
              <Alert tone="warning"><span className="flex items-start gap-2"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden />This sale has started, so its start and early access cannot change. To run it longer, use Extend on the campaign page (customers are told it was extended).</span></Alert>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {timeField('teaserStartsAt', 'Teaser starts', 'Banner and countdown appear, no sale prices yet', started)}
              {timeField('earlyAccessStartsAt', 'Early access starts', 'Members can buy at sale prices (max 72 hours before the sale)', started)}
              {timeField('startsAt', 'Sale starts', 'Sale prices apply for everyone', started)}
              {timeField('endsAt', 'Sale ends', 'At most 45 days after the start', started)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Banner</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Alert tone="info" className="sm:col-span-2">
              Do not type discount figures such as &quot;50% off&quot;. The storefront shows &quot;Up to X% off&quot; automatically, computed from the real in-stock sale prices, so the claim is always true.
            </Alert>
            <Field label="Banner title" htmlFor="cf-btitle" error={errors.bannerTitle?.message} hint="Up to 60 characters. Blank uses the campaign name">
              <Input id="cf-btitle" maxLength={60} invalid={!!errors.bannerTitle} {...register('bannerTitle')} />
            </Field>
            <Field label="Banner subtitle" htmlFor="cf-bsub" error={errors.bannerSubtitle?.message} hint="Up to 120 characters">
              <Input id="cf-bsub" maxLength={120} invalid={!!errors.bannerSubtitle} {...register('bannerSubtitle')} />
            </Field>
            <Field label="Banner image URL" htmlFor="cf-bimg" error={errors.bannerImageUrl?.message} hint="Optional" className="sm:col-span-2">
              <Input id="cf-bimg" type="url" inputMode="url" {...register('bannerImageUrl')} />
            </Field>
            <Field label="Theme colour" htmlFor="cf-theme" error={errors.themeColor?.message} hint="Hex, e.g. #7a1f2b">
              <div className="flex items-center gap-2">
                <input type="color" aria-label="Pick theme colour" value={/^#[0-9a-f]{6}$/i.test(themeColor) ? themeColor : '#000000'} onChange={(e) => setValue('themeColor', e.target.value, { shouldDirty: true })}
                  className="h-11 w-12 shrink-0 cursor-pointer rounded-md border border-border-strong bg-bg p-1 sm:h-10" />
                <Input id="cf-theme" className="font-mono" placeholder="#7a1f2b" invalid={!!errors.themeColor} {...register('themeColor')} />
              </div>
            </Field>
          </CardContent>
        </Card>

        <div className="sticky bottom-0 z-10 -mx-3 flex justify-end gap-2 border-t border-border bg-bg/95 px-3 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <Button type="button" variant="ghost" className="max-sm:h-11" onClick={() => router.push(campaign ? `/campaigns/${campaign.id}` : '/campaigns')}>Cancel</Button>
          <Button type="submit" className="max-sm:h-11" loading={isSubmitting}>{campaign ? 'Save changes' : 'Create draft'}</Button>
        </div>
      </form>
    </>
  );
}
