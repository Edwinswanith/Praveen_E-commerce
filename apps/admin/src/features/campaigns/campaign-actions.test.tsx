import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CampaignAdminDto, CampaignPhase, CampaignStatus } from '@vyra/shared';
import { api, ApiError } from '@/lib/api';
import { CampaignActions } from './campaign-actions';
import { campaignActions } from './campaign-rules';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, href, ...p }: { children: React.ReactNode; href: string }) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, post: vi.fn(), delete: vi.fn() } };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function c(status: CampaignStatus, phase: CampaignPhase, over: Partial<CampaignAdminDto> = {}): CampaignAdminDto {
  return {
    id: 'c1', slug: 's', name: 'Sale', edition: null, festival: null, description: null, phase,
    teaserStartsAt: null, earlyAccessStartsAt: null, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-10T00:00:00Z',
    extended: false, originalEndsAt: null, countdownTo: null, banner: { title: null, subtitle: null, imageUrl: null, themeColor: null },
    claim: { upToPercent: null, productCount: 0 }, promotions: [], hasEarlyAccess: false, subscribed: false,
    status, priority: 0, budget: null, budgetUsed: 0, priceCount: 1, subscriberCount: 0, publishedAt: status === 'DRAFT' ? null : '2026-10-30T00:00:00Z', createdAt: '2026-10-30T00:00:00Z', ...over,
  };
}

const shown = (x: ReturnType<typeof campaignActions>) => Object.entries(x).filter(([, v]) => v.visible).map(([k]) => k).sort();

describe('campaignActions gating', () => {
  it.each<[CampaignStatus, CampaignPhase, string[]]>([
    ['DRAFT', 'DRAFT', ['delete', 'edit', 'publish']],
    ['SCHEDULED', 'UPCOMING', ['cancel', 'edit', 'extend', 'pause']],
    ['SCHEDULED', 'TEASER', ['cancel', 'edit', 'extend', 'pause']],
    ['SCHEDULED', 'EARLY_ACCESS', ['cancel', 'edit', 'extend', 'pause']],
    ['SCHEDULED', 'LIVE', ['cancel', 'edit', 'extend', 'pause']],
    ['PAUSED', 'PAUSED', ['cancel', 'edit', 'extend', 'resume']],
    ['SCHEDULED', 'ENDED', ['extend']],
    ['PAUSED', 'ENDED', ['extend']],
    ['CANCELLED', 'CANCELLED', []],
  ])('%s / %s shows %j', (status, phase, expected) => {
    expect(shown(campaignActions(c(status, phase), true))).toEqual(expected);
  });

  it('shows nothing without promotions:write', () => {
    expect(shown(campaignActions(c('DRAFT', 'DRAFT'), false))).toEqual([]);
    expect(shown(campaignActions(c('SCHEDULED', 'LIVE'), false))).toEqual([]);
  });

  it('refuses resume while the budget is used up', () => {
    const a = campaignActions(c('PAUSED', 'PAUSED', { budget: 1000, budgetUsed: 1000 }), true);
    expect(a.resume.disabledReason).toMatch(/Raise the budget/);
    expect(campaignActions(c('PAUSED', 'PAUSED', { budget: 1000, budgetUsed: 999 }), true).resume.disabledReason).toBeNull();
  });
});

describe('<CampaignActions>', () => {
  beforeEach(() => { vi.mocked(api.post).mockReset(); });

  it('renders only the allowed buttons for a live sale', () => {
    render(<CampaignActions campaign={c('SCHEDULED', 'LIVE')} canWrite onChanged={() => {}} />);
    for (const name of [/pause/i, /extend/i, /cancel campaign/i, /edit/i]) expect(screen.getByRole(name.source === 'edit' ? 'link' : 'button', { name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /resume/i })).toBeNull();
  });

  it('disables publish with the blocking checklist reason', () => {
    render(<CampaignActions campaign={c('DRAFT', 'DRAFT')} canWrite publishBlocked="Fix the checklist first: Add at least one sale price or bundle offer" onChanged={() => {}} />);
    const btn = screen.getByRole('button', { name: /publish/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription(/Add at least one sale price/);
  });

  it('pauses with an optional note after confirming', async () => {
    const onChanged = vi.fn();
    vi.mocked(api.post).mockResolvedValue(c('PAUSED', 'PAUSED'));
    render(<CampaignActions campaign={c('SCHEDULED', 'LIVE')} canWrite onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    fireEvent.change(await screen.findByLabelText('Note (optional)'), { target: { value: 'Stock check' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/campaigns/c1/pause', { note: 'Stock check' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'PAUSED' })));
  });

  it('extend needs a later end (entered in IST) and a reason', async () => {
    vi.mocked(api.post).mockResolvedValue(c('SCHEDULED', 'LIVE', { extended: true }));
    render(<CampaignActions campaign={c('SCHEDULED', 'LIVE', { endsAt: '2099-11-10T00:00:00Z' })} canWrite onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /extend/i }));
    const end = await screen.findByLabelText('New end (IST)');
    fireEvent.change(end, { target: { value: '2099-11-09T12:00' } });
    expect(screen.getByText('Must be later than the current end')).toBeInTheDocument();
    fireEvent.change(end, { target: { value: '2099-11-12T00:00' } });
    const confirm = screen.getAllByRole('button', { name: 'Extend' }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Demand' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/campaigns/c1/extend', { endsAt: '2099-11-11T18:30:00.000Z', note: 'Demand' }));
  });

  it('shows the API reason when an action is refused', async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError('BAD_REQUEST', 'The discount budget is used up. Raise the budget before resuming.', 400));
    render(<CampaignActions campaign={c('PAUSED', 'PAUSED')} canWrite onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    expect(await screen.findByText(/budget is used up/)).toBeInTheDocument();
  });
});
