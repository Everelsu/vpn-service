export type Currency = 'usd' | 'eur' | 'rub'; // ISO 4217 lowercase, Stripe format

export const CURRENCIES: readonly Currency[] = ['usd', 'eur', 'rub'] as const;

/**
 * The provider declines charges below this. No order is ever created under it,
 * and a discount that would dip below it clamps to it rather than to zero.
 * Stripe takes 50 cents; YooKassa takes one rouble.
 */
export const MIN_CHARGE_MINOR: Record<Currency, number> = { usd: 50, eur: 50, rub: 100 };
