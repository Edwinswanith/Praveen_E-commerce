/**
 * IST (Asia/Kolkata, UTC+05:30, no daylight saving) helpers for campaign times.
 * Campaign instants are stored in UTC; staff enter and read them in IST no matter
 * which timezone their browser is in, so never use the browser's local time here.
 */

const IST_OFFSET_MS = 330 * 60_000;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** `<input type="datetime-local">` value read as IST wall time → ISO (UTC). '' or invalid → null. */
export function istInputToIso(value: string | null | undefined): string | null {
  const m = value ? LOCAL_RE.exec(value.trim()) : null;
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x))) as [number, number, number, number, number, number];
  if (h > 23 || mi > 59 || s > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s) - IST_OFFSET_MS;
  const check = new Date(utc + IST_OFFSET_MS);
  // Reject overflow such as 2026-02-31.
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return new Date(utc).toISOString();
}

/** ISO instant → IST wall time for `<input type="datetime-local">` (minute precision). */
export function isoToIstInput(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const d = new Date(t + IST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const istFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
});

/** "13 Nov 2026, 4:37 pm IST". */
export function formatIstDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${istFmt.format(d)} IST`;
}

/** "9d 4h", "3h 12m", "45m", "under a minute" until `target` from `now`. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'under a minute';
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${mm}m`;
  return `${mm}m`;
}
