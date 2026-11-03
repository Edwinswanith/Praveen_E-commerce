const extraHosts = (process.env.NEXT_PUBLIC_IMAGE_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

/**
 * Whether next/image should skip optimisation for this URL. API media is
 * served as relative `/media/...` (proxied by the rewrite) and seed images are
 * SVG, so those are passed through untouched. Absolute hosts are optimised
 * only when allow-listed in next.config (localhost:4000 or NEXT_PUBLIC_IMAGE_HOSTS).
 */
export function shouldSkipOptimization(src: string): boolean {
  if (src.startsWith('/') || src.startsWith('blob:') || src.startsWith('data:')) return true;
  if (/\.svg(\?|$)/i.test(src)) return true;
  try {
    const u = new URL(src);
    if (u.hostname === 'localhost' && u.port === '4000') return false;
    return !(u.protocol === 'https:' && extraHosts.includes(u.hostname));
  } catch {
    return true;
  }
}
