import { describe, expect, it } from 'vitest';
import { formatDuration, formatIstDateTime, istInputToIso, isoToIstInput } from './ist';

describe('IST conversion', () => {
  it('00:00 IST on a date is 18:30Z on the previous day', () => {
    expect(istInputToIso('2026-11-10T00:00')).toBe('2026-11-09T18:30:00.000Z');
    expect(istInputToIso('2027-01-01T00:00')).toBe('2026-12-31T18:30:00.000Z');
  });

  it('round-trips IST wall time through ISO', () => {
    for (const v of ['2026-11-10T00:00', '2026-11-10T05:29', '2026-11-10T05:30', '2026-11-13T23:59', '2028-02-29T12:00']) {
      expect(isoToIstInput(istInputToIso(v))).toBe(v);
    }
  });

  it('round-trips an ISO instant at minute precision', () => {
    expect(isoToIstInput('2026-11-13T11:07:41.760Z')).toBe('2026-11-13T16:37');
    expect(istInputToIso(isoToIstInput('2026-11-13T11:07:00.000Z'))).toBe('2026-11-13T11:07:00.000Z');
  });

  it('does not depend on the browser timezone', () => {
    // The helpers only use UTC getters plus the fixed +05:30 offset (IST has no DST).
    const iso = istInputToIso('2026-03-29T02:30');
    expect(iso).toBe('2026-03-28T21:00:00.000Z');
    expect(isoToIstInput(new Date(iso!))).toBe('2026-03-29T02:30');
  });

  it('rejects blank or impossible values', () => {
    expect(istInputToIso('')).toBeNull();
    expect(istInputToIso(null)).toBeNull();
    expect(istInputToIso('2026-02-31T10:00')).toBeNull();
    expect(istInputToIso('not a date')).toBeNull();
    expect(isoToIstInput('nope')).toBe('');
    expect(isoToIstInput(null)).toBe('');
  });

  it('formats in IST with a label', () => {
    expect(formatIstDateTime('2026-11-09T18:30:00.000Z')).toMatch(/10 Nov 2026, 12:00\s?am IST/i);
    expect(formatIstDateTime(null)).toBe('-');
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('now');
    expect(formatDuration(30_000)).toBe('under a minute');
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration((3 * 60 + 12) * 60_000)).toBe('3h 12m');
    expect(formatDuration((9 * 24 + 4) * 3600_000 + 5 * 60_000)).toBe('9d 4h');
  });
});
