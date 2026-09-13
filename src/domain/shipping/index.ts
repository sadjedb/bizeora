import { err, ok, type Result } from '../result';

/**
 * Shipping resolution.
 *
 * `BUSINESS-RULES.md` section 4, which section 16 requires to live in
 * `domain/shipping` exactly once — consumed by the cart, checkout, order
 * placement and the admin.
 *
 * Section 4.1:
 *
 *     zone     = zoneForWilaya(wilayaCode)          // exactly one, unique index
 *     rate     = rateFor(zone, deliveryType)        // HOME or DESK
 *     shipping = (rate.freeOverAmount != null &&
 *                 subtotalAfterDiscount >= rate.freeOverAmount) ? 0 : rate.price
 *
 * Two rules are easy to get wrong and are therefore encoded rather than
 * remembered:
 *
 *   4.2   `shipping_rates.freeOverAmount` is the **only** runtime source of a
 *         free-delivery threshold. `settings.shipping.defaultFreeThreshold`
 *         pre-fills the column when a rate is created and is never read here.
 *         A rate with a null `freeOverAmount` offers no free delivery; it does
 *         not fall back to the setting. That is why this function takes a rate
 *         and no settings at all — the setting is unreachable from here.
 *
 *   4.2.1 The threshold compares against the subtotal **after** discounts, so a
 *         discount cannot be used to reach a threshold it no longer qualifies
 *         for.
 */

export type DeliveryType = 'HOME' | 'DESK';

/** Everything shipping resolution reads from a rate row. */
export type ApplicableRate = {
  id: string;
  deliveryType: DeliveryType;
  price: number;
  /** `null` means this rate never offers free delivery (4.2). */
  freeOverAmount: number | null;
  estimatedMinDays: number;
  estimatedMaxDays: number;
  /** The zone's name, for the immutable label (4.7). */
  zoneName: string;
};

export type ResolvedShipping = {
  amount: number;
  rateId: string;
  /** Snapshotted onto the order so a historical charge stays explainable. */
  label: string;
  estimatedMinDays: number;
  estimatedMaxDays: number;
  /** True when the threshold was met, so the UI can say so rather than show 0. */
  isFree: boolean;
};

export type ShippingError = { code: 'WILAYA_NOT_SERVED' | 'DELIVERY_TYPE_NOT_OFFERED' };

const DELIVERY_TYPE_LABELS: Record<DeliveryType, string> = {
  HOME: 'Livraison à domicile',
  DESK: 'Livraison au bureau',
};

/**
 * 4.7: `shippingRateLabel`, e.g. "Nord — Livraison au bureau".
 *
 * Written once at placement and never recomputed. Rate rows are deactivated
 * rather than deleted, but their prices are edited, so the label is what keeps
 * an old delivery charge explainable.
 */
export function shippingRateLabel(zoneName: string, deliveryType: DeliveryType): string {
  return `${zoneName} — ${DELIVERY_TYPE_LABELS[deliveryType]}`;
}

/** 4.6: a quote-derived order records this instead, and no rate is looked up. */
export const QUOTED_SHIPPING_LABEL = 'Livraison devisée';

/**
 * The delivery charge for a subtotal.
 *
 * `subtotalAfterDiscount` is exactly that — the caller must subtract discounts
 * before calling, per 4.2.1. Passing the pre-discount subtotal would let a
 * discounted order qualify for free delivery it no longer earns.
 */
export function resolveShipping(
  rate: ApplicableRate,
  subtotalAfterDiscount: number,
): ResolvedShipping {
  const isFree =
    rate.freeOverAmount !== null && subtotalAfterDiscount >= rate.freeOverAmount;

  return {
    amount: isFree ? 0 : rate.price,
    rateId: rate.id,
    label: shippingRateLabel(rate.zoneName, rate.deliveryType),
    estimatedMinDays: rate.estimatedMinDays,
    estimatedMaxDays: rate.estimatedMaxDays,
    isFree,
  };
}

/**
 * Pick the rate for a delivery type from the rates a zone offers.
 *
 * 4.4: an unmapped wilaya blocks checkout with an explicit message rather than
 * silently defaulting to a rate — so both failures are typed and neither has a
 * fallback value.
 */
export function selectRate(
  rates: readonly ApplicableRate[],
  deliveryType: DeliveryType,
): Result<ApplicableRate, ShippingError> {
  if (rates.length === 0) return err({ code: 'WILAYA_NOT_SERVED' as const });

  const rate = rates.find((candidate) => candidate.deliveryType === deliveryType);
  if (!rate) return err({ code: 'DELIVERY_TYPE_NOT_OFFERED' as const });

  return ok(rate);
}

/**
 * How much more is needed to earn free delivery, or `null` when the rate has no
 * threshold or the threshold is already met.
 *
 * The cart's free-delivery progress indicator reads this, and 4.2 requires it
 * to come from the same `freeOverAmount` the charge does — an indicator driven
 * by the settings default would promise a discount the checkout then refuses.
 */
export function remainingForFreeShipping(
  rate: ApplicableRate,
  subtotalAfterDiscount: number,
): number | null {
  if (rate.freeOverAmount === null) return null;

  const remaining = rate.freeOverAmount - subtotalAfterDiscount;
  return remaining > 0 ? remaining : null;
}
