import { formatINR, type CampaignAdminDto, type CampaignPhase, type CampaignPriceRowDto } from '@vyra/shared';

/**
 * UI mirror of the rules CampaignsService enforces. The API is the authority;
 * these only decide which controls to show and how to explain a refusal
 * before the round trip.
 */

export type CampaignAction = 'publish' | 'pause' | 'resume' | 'cancel' | 'extend' | 'delete' | 'edit';

export interface ActionState { visible: boolean; disabledReason: string | null }

type C = Pick<CampaignAdminDto, 'status' | 'phase' | 'startsAt' | 'budget' | 'budgetUsed' | 'publishedAt'>;

const OVER: CampaignPhase[] = ['ENDED', 'CANCELLED'];

export function budgetExhausted(c: Pick<CampaignAdminDto, 'budget' | 'budgetUsed'>): boolean {
  return c.budget != null && c.budget > 0 && c.budgetUsed >= c.budget;
}

/** The sale has started selling (or was paused after starting): window and deals are locked. */
export function hasStartedSelling(c: Pick<CampaignAdminDto, 'status' | 'phase' | 'startsAt'>, now = new Date()): boolean {
  if (c.status === 'DRAFT') return false;
  if (c.phase === 'EARLY_ACCESS' || c.phase === 'LIVE') return true;
  return c.phase === 'PAUSED' && new Date(c.startsAt).getTime() <= now.getTime();
}

/** Which lifecycle actions to show, mirroring CampaignsService.publish/setStatus/extend/remove/update. */
export function campaignActions(c: C, canWrite: boolean): Record<CampaignAction, ActionState> {
  const hide: ActionState = { visible: false, disabledReason: null };
  const show = (disabledReason: string | null = null): ActionState => ({ visible: true, disabledReason });
  if (!canWrite) return { publish: hide, pause: hide, resume: hide, cancel: hide, extend: hide, delete: hide, edit: hide };
  const ended = c.phase === 'ENDED';
  return {
    publish: c.status === 'DRAFT' ? show() : hide,
    pause: c.status === 'SCHEDULED' && !ended ? show() : hide,
    resume: c.status === 'PAUSED' && !ended
      ? show(budgetExhausted(c) ? 'The discount budget is used up. Raise the budget before resuming.' : null)
      : hide,
    cancel: (c.status === 'SCHEDULED' || c.status === 'PAUSED') && !ended ? show() : hide,
    extend: c.status === 'SCHEDULED' || c.status === 'PAUSED' ? show() : hide,
    delete: c.status === 'DRAFT' ? show() : hide,
    edit: OVER.includes(c.phase) ? hide : show(),
  };
}

/** Rules for the price table, mirroring setPrices / removePrice. */
export function priceRules(c: Pick<CampaignAdminDto, 'status' | 'phase' | 'startsAt'>, now = new Date()) {
  const readOnly = OVER.includes(c.phase);
  // setPrices treats any non-draft EARLY_ACCESS / LIVE / PAUSED campaign as selling.
  const onlyDown = !readOnly && c.status !== 'DRAFT' && (c.phase === 'EARLY_ACCESS' || c.phase === 'LIVE' || c.phase === 'PAUSED');
  const lockedDeals = readOnly || hasStartedSelling(c, now);
  return {
    readOnly,
    onlyDown,
    canRemove: !lockedDeals,
    removeReason: readOnly
      ? 'This campaign is over; its deals are kept for the report.'
      : lockedDeals ? 'Deals cannot be removed once the sale has started (they were advertised). Set a stock cap instead.' : null,
  };
}

export interface PriceEdit { salePrice: string; stockCap: string; perCustomerLimit: string }

/** Client-side checks for one edited row. Returns messages (empty = OK to send). */
export function validatePriceEdit(row: CampaignPriceRowDto, edit: PriceEdit, rules: { onlyDown: boolean }): string[] {
  const errs: string[] = [];
  const sale = Number(edit.salePrice);
  if (edit.salePrice.trim() === '' || !Number.isFinite(sale) || sale <= 0) errs.push('Enter a sale price');
  else {
    if (!/^\d+(\.\d{1,2})?$/.test(edit.salePrice.trim())) errs.push('Use at most 2 decimals');
    if (sale >= row.regularPrice) errs.push(`Must be below the regular price ${formatINR(row.regularPrice)}`);
    if (row.costPrice != null && sale < row.costPrice) errs.push(`Below cost ${formatINR(row.costPrice)}: never sell below cost`);
    if (rules.onlyDown && sale > row.salePrice) errs.push(`The sale is running: the price can only go down (now ${formatINR(row.salePrice)})`);
  }
  const cap = edit.stockCap.trim();
  if (cap) {
    const n = Number(cap);
    if (!Number.isInteger(n) || n < 1 || n > 100000) errs.push('Cap must be a whole number from 1');
    else if (n < row.soldCount) errs.push(`Cap cannot be below the ${row.soldCount} already sold`);
  }
  const lim = edit.perCustomerLimit.trim();
  if (lim) {
    const n = Number(lim);
    if (!Number.isInteger(n) || n < 1 || n > 50) errs.push('Per-customer limit must be 1 to 50');
  }
  return errs;
}

export function percentOff(base: number, sale: number): number {
  if (base <= 0 || sale >= base) return 0;
  return Math.round(((base - sale) / base) * 100);
}
