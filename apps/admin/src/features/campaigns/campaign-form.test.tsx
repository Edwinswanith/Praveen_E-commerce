import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CampaignAdminDto } from '@vyra/shared';
import { api } from '@/lib/api';
import { buildCampaignPayload, campaignToValues, CampaignForm, windowProblems, type CampaignFormValues } from './campaign-form';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, href, ...p }: { children: React.ReactNode; href: string }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn(), patch: vi.fn() } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const base: CampaignFormValues = {
  ...campaignToValues(),
  name: 'Diwali Dhamaka', slug: 'diwali-dhamaka', startsAt: '2026-11-10T00:00', endsAt: '2026-11-15T23:59',
};

function campaign(over: Partial<CampaignAdminDto> = {}): CampaignAdminDto {
  return {
    id: 'c1', slug: 'festive-edit', name: 'Festive Edit Sale', edition: '2026', festival: 'Diwali', description: null, phase: 'LIVE',
    teaserStartsAt: '2026-11-01T11:07:41.760Z', earlyAccessStartsAt: null, startsAt: '2026-11-03T10:07:41.760Z', endsAt: '2026-11-13T11:07:41.760Z',
    extended: false, originalEndsAt: null, countdownTo: '2026-11-13T11:07:41.760Z',
    banner: { title: 'The Festive Edit', subtitle: null, imageUrl: null, themeColor: '#7a1f2b' }, claim: { upToPercent: 60, productCount: 4 },
    promotions: [], hasEarlyAccess: false, subscribed: false, status: 'SCHEDULED', priority: 10, budget: 250000, budgetUsed: 0,
    priceCount: 50, subscriberCount: 0, publishedAt: '2026-11-03T11:07:41.920Z', createdAt: '2026-11-03T11:07:41.763Z', ...over,
  };
}

describe('windowProblems', () => {
  it('is empty for a valid window', () => {
    expect(windowProblems(base)).toEqual({});
  });
  it('flags an end before the start, too long a sale, and out-of-order teaser / early access', () => {
    expect(windowProblems({ ...base, endsAt: '2026-11-09T00:00' }).endsAt).toBe('End must be after start');
    expect(windowProblems({ ...base, endsAt: '2027-01-30T00:00' }).endsAt).toBe('A sale can run at most 45 days');
    expect(windowProblems({ ...base, earlyAccessStartsAt: '2026-11-06T00:00' }).earlyAccessStartsAt).toBe('Early access can be at most 72 hours');
    expect(windowProblems({ ...base, earlyAccessStartsAt: '2026-11-10T00:00' }).earlyAccessStartsAt).toBe('Early access must start before the sale');
    expect(windowProblems({ ...base, earlyAccessStartsAt: '2026-11-09T00:00', teaserStartsAt: '2026-11-09T06:00' }).teaserStartsAt).toMatch(/teaser must start before/i);
  });
});

describe('buildCampaignPayload', () => {
  it('converts IST inputs to UTC instants and blanks to null', () => {
    const r = buildCampaignPayload(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toMatchObject({ startsAt: '2026-11-09T18:30:00.000Z', endsAt: '2026-11-15T18:29:00.000Z', teaserStartsAt: null, budget: null, festival: null });
  });

  it('rejects typed % claims in banner copy', () => {
    const r = buildCampaignPayload({ ...base, bannerTitle: 'Flat 50% off everything' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.bannerTitle).toMatch(/computed from real prices/);
  });

  it('requires start and end, and validates slug and colour', () => {
    const r = buildCampaignPayload({ ...base, startsAt: '', slug: 'Not A Slug', themeColor: 'red' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.startsAt).toBe('Required');
    expect(r.errors.slug).toMatch(/lowercase/i);
    expect(r.errors.themeColor).toBeTruthy();
  });

  it('on edit of a running sale, never sends the locked window or slug, but always sends priority', () => {
    const c = campaign();
    const r = buildCampaignPayload({ ...campaignToValues(c), bannerSubtitle: 'New subtitle' }, c, new Date('2026-11-05T00:00:00Z'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).not.toHaveProperty('startsAt');
    expect(r.payload).not.toHaveProperty('endsAt');
    expect(r.payload).not.toHaveProperty('earlyAccessStartsAt');
    expect(r.payload).not.toHaveProperty('teaserStartsAt');
    expect(r.payload).not.toHaveProperty('slug');
    expect(r.payload).toMatchObject({ bannerSubtitle: 'New subtitle', priority: '10' });
  });

  it('on edit of a draft, sends only the window fields that changed', () => {
    const c = campaign({ status: 'DRAFT', phase: 'DRAFT', publishedAt: null });
    const r = buildCampaignPayload({ ...campaignToValues(c), endsAt: '2026-11-14T23:59' }, c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.endsAt).toBe('2026-11-14T18:29:00.000Z');
    expect(r.payload).not.toHaveProperty('startsAt');
  });
});

describe('<CampaignForm>', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); push.mockReset(); });

  it('shows window problems inline before submitting', () => {
    render(<CampaignForm />);
    fireEvent.change(screen.getByLabelText('Sale starts'), { target: { value: '2026-11-10T00:00' } });
    fireEvent.change(screen.getByLabelText('Sale ends'), { target: { value: '2026-11-09T00:00' } });
    expect(screen.getByText('End must be after start')).toBeInTheDocument();
    expect(screen.getByLabelText('Sale ends')).toHaveAttribute('aria-invalid', 'true');
  });

  it('explains that the % claim is automatic and refuses a typed one without calling the API', async () => {
    render(<CampaignForm />);
    expect(screen.getByText(/computed from the real in-stock sale prices/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Diwali Dhamaka' } });
    expect(screen.getByLabelText('URL slug')).toHaveValue('diwali-dhamaka');
    fireEvent.change(screen.getByLabelText('Sale starts'), { target: { value: '2026-11-10T00:00' } });
    fireEvent.change(screen.getByLabelText('Sale ends'), { target: { value: '2026-11-15T00:00' } });
    fireEvent.change(screen.getByLabelText('Banner title'), { target: { value: 'Up to 70% off' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByText(/Do not type % figures here/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('creates a draft with UTC times and opens it', async () => {
    vi.mocked(api.post).mockResolvedValue(campaign({ id: 'new1', status: 'DRAFT', phase: 'DRAFT' }));
    render(<CampaignForm />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Diwali Dhamaka' } });
    fireEvent.change(screen.getByLabelText('Sale starts'), { target: { value: '2026-11-10T00:00' } });
    fireEvent.change(screen.getByLabelText('Sale ends'), { target: { value: '2026-11-15T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0]![1]).toMatchObject({ slug: 'diwali-dhamaka', startsAt: '2026-11-09T18:30:00.000Z', endsAt: '2026-11-14T18:30:00.000Z' });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/campaigns/new1'));
  });

  it('locks the window and slug of a running, published sale', () => {
    render(<CampaignForm campaign={campaign()} onSaved={() => {}} />);
    expect(screen.getByLabelText('Sale starts')).toBeDisabled();
    expect(screen.getByLabelText('Sale ends')).toBeDisabled();
    expect(screen.getByLabelText('URL slug')).toBeDisabled();
    expect(screen.getByText(/use Extend on the campaign page/i)).toBeInTheDocument();
  });
});
