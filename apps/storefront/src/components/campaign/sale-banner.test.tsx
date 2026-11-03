import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { formatIST, type CampaignPublicDto } from '@vyra/shared';
import { bannerColors, BRAND_INK, countdownLabel } from '@/lib/campaigns';
import { HomeSaleBanner, SaleBannerContent } from './sale-banner';

const NOW = new Date('2026-11-05T06:30:00.000Z');

function campaign(over: Partial<CampaignPublicDto> = {}): CampaignPublicDto {
  return {
    id: 'c1',
    slug: 'festive-edit',
    name: 'Festive Edit Sale',
    edition: '2026',
    festival: 'Diwali',
    description: 'Ethnic wear on sale.',
    phase: 'LIVE',
    teaserStartsAt: null,
    earlyAccessStartsAt: null,
    startsAt: '2026-11-03T10:00:00.000Z',
    endsAt: '2026-11-13T11:00:00.000Z',
    extended: false,
    originalEndsAt: null,
    countdownTo: '2026-11-13T11:00:00.000Z',
    banner: { title: 'The Festive Edit', subtitle: 'Kurtas on sale', imageUrl: null, themeColor: '#7a1f2b' },
    claim: { upToPercent: 60, productCount: 4 },
    promotions: [],
    hasEarlyAccess: false,
    subscribed: false,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('<SaleBannerContent /> claim', () => {
  it('shows the server claim as "Up to X% off"', () => {
    render(<SaleBannerContent campaign={campaign()} />);
    expect(screen.getByTestId('sale-claim')).toHaveTextContent('Up to 60% off');
    expect(screen.getByRole('heading', { name: 'The Festive Edit' })).toBeInTheDocument();
    expect(screen.getByText('Kurtas on sale')).toBeInTheDocument();
  });

  it('never shows or invents a % when claim.upToPercent is null', () => {
    render(<SaleBannerContent campaign={campaign({ claim: { upToPercent: null, productCount: 0 } })} />);
    expect(screen.queryByTestId('sale-claim')).toBeNull();
    expect(screen.getByTestId('sale-banner').textContent).not.toMatch(/%/);
  });

  it('with a null claim, the only % shown is the bundle offer from its own numbers', () => {
    render(
      <SaleBannerContent
        campaign={campaign({
          claim: { upToPercent: null, productCount: 0 },
          promotions: [{ id: 'p1', name: 'Anything', minQuantity: 2, percentOff: 10 }],
        })}
      />,
    );
    expect(screen.getByText('Buy 2, extra 10% off')).toBeInTheDocument();
    const percents = screen.getByTestId('sale-banner').textContent!.match(/\d+%/g);
    expect(percents).toEqual(['10%']);
  });
});

describe('<SaleBannerContent /> countdown', () => {
  it('counts down to countdownTo only (not endsAt), after mount', () => {
    const c = campaign({ countdownTo: new Date(NOW.getTime() + 90_000).toISOString() });
    render(<SaleBannerContent campaign={c} />);
    const el = screen.getByTestId('campaign-countdown');
    expect(el).toHaveTextContent('Ends in');
    expect(el).toHaveTextContent('00h 01m 30s');
    expect(el.querySelector('time')!.getAttribute('datetime')).toBe(c.countdownTo);
  });

  it('renders no countdown without countdownTo', () => {
    render(<SaleBannerContent campaign={campaign({ countdownTo: null })} />);
    expect(screen.queryByTestId('campaign-countdown')).toBeNull();
  });

  it('stops at zero (never negative) and asks for a refetch once', () => {
    const onExpire = vi.fn();
    render(
      <SaleBannerContent
        campaign={campaign({ countdownTo: new Date(NOW.getTime() + 2_000).toISOString() })}
        onExpire={onExpire}
      />,
    );
    expect(screen.getByTestId('campaign-countdown')).toHaveTextContent('00h 00m 02s');
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByTestId('campaign-countdown')).toHaveTextContent('00h 00m 01s');
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByTestId('campaign-countdown')).toBeNull();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByTestId('campaign-countdown')).toBeNull();
    expect(screen.getByTestId('sale-banner').textContent).not.toMatch(/-\d/);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('a countdownTo already in the past shows nothing and refetches', () => {
    const onExpire = vi.fn();
    render(
      <SaleBannerContent campaign={campaign({ countdownTo: new Date(NOW.getTime() - 5_000).toISOString() })} onExpire={onExpire} />,
    );
    expect(screen.queryByTestId('campaign-countdown')).toBeNull();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('labels the countdown by phase', () => {
    const at = NOW.toISOString();
    expect(countdownLabel({ phase: 'TEASER', countdownTo: at, earlyAccessStartsAt: null, hasEarlyAccess: false })).toBe('Starts in');
    expect(countdownLabel({ phase: 'TEASER', countdownTo: at, earlyAccessStartsAt: at, hasEarlyAccess: false })).toBe('Early access starts in');
    expect(countdownLabel({ phase: 'EARLY_ACCESS', countdownTo: at, earlyAccessStartsAt: at, hasEarlyAccess: true })).toBe('Early access ends in');
    expect(countdownLabel({ phase: 'EARLY_ACCESS', countdownTo: at, earlyAccessStartsAt: at, hasEarlyAccess: false })).toBe('Sale starts in');
    expect(countdownLabel({ phase: 'LIVE', countdownTo: at, earlyAccessStartsAt: null, hasEarlyAccess: false })).toBe('Ends in');
    expect(countdownLabel({ phase: 'PAUSED', countdownTo: at, earlyAccessStartsAt: null, hasEarlyAccess: false })).toBeNull();
  });
});

describe('<SaleBannerContent /> extension and colour', () => {
  it('discloses an extension with the original end', () => {
    const originalEndsAt = '2026-11-10T18:29:00.000Z';
    render(<SaleBannerContent campaign={campaign({ extended: true, originalEndsAt })} />);
    expect(screen.getByTestId('sale-extended')).toHaveTextContent(
      `Extended. Originally ended ${formatIST(originalEndsAt)}`,
    );
  });

  it('shows no extension notice when not extended', () => {
    render(<SaleBannerContent campaign={campaign()} />);
    expect(screen.queryByTestId('sale-extended')).toBeNull();
  });

  it('keeps AA contrast: light theme colours fall back to brand ink', () => {
    expect(bannerColors('#7a1f2b')).toEqual({ background: '#7a1f2b', color: '#ffffff' });
    expect(bannerColors('#ffd166')).toEqual({ background: BRAND_INK, color: '#ffffff' });
    expect(bannerColors('not-a-colour')).toEqual({ background: BRAND_INK, color: '#ffffff' });
    expect(bannerColors(null)).toEqual({ background: BRAND_INK, color: '#ffffff' });
  });
});

describe('<HomeSaleBanner />', () => {
  it('refetches the campaign when the countdown reaches zero', async () => {
    const live = campaign({ countdownTo: new Date(NOW.getTime() + 1_000).toISOString() });
    const ended: CampaignPublicDto[] = [];
    const fetcher = vi.fn().mockResolvedValueOnce([live]).mockResolvedValue(ended);
    render(
      <SWRConfig value={{ provider: () => new Map(), fetcher, dedupingInterval: 0 }}>
        <HomeSaleBanner initial={[live]} />
      </SWRConfig>,
    );
    await act(async () => {});
    expect(screen.getByTestId('sale-banner')).toBeInTheDocument();
    const calls = fetcher.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await act(async () => {});
    expect(fetcher.mock.calls.length).toBeGreaterThan(calls);
    expect(fetcher).toHaveBeenLastCalledWith('/campaigns/current');
    expect(screen.queryByTestId('sale-banner')).toBeNull();
  });
});
