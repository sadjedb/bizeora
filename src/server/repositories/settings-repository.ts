import 'server-only';

import { prisma } from '@/lib/db/client';
import type { CustomizationRates } from '@/domain/pricing/customization';
import type { DiscountTier } from '@/domain/discount';

/**
 * The settings and tiers commerce reads.
 *
 * Deliberately overlapping with the builder's loader rather than shared with
 * it: the builder needs quote thresholds it must not be able to price without,
 * checkout needs the deposit percentage the builder never sees. Both read the
 * same rows through the same rule — **a missing setting throws**, because a
 * silent default would quote a number the business never agreed to.
 */

const REQUIRED_SETTINGS = [
  'custom_orders.depositPercent',
  'custom_orders.threadColorSurchargePerColor',
  'custom_orders.textSurcharge',
  'custom_orders.setupFee',
  'custom_orders.setupFeeWaiverQuantity',
  'custom_orders.estimateBandPercent',
] as const;

export type CommerceSettings = CustomizationRates & {
  /** `custom_orders.depositPercent`, basis points. 5000 = 50% (5.5). */
  depositPercentBasisPoints: number;
};

export async function loadCommerceSettings(): Promise<CommerceSettings> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...REQUIRED_SETTINGS] } },
    select: { key: true, value: true },
  });

  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  function number(key: (typeof REQUIRED_SETTINGS)[number]): number {
    const raw = byKey.get(key);
    const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);

    if (!Number.isFinite(parsed)) {
      throw new Error(`Setting ${key} is missing or not an integer. Run the seed.`);
    }
    return parsed;
  }

  return {
    depositPercentBasisPoints: number('custom_orders.depositPercent'),
    threadColorSurchargePerColor: number('custom_orders.threadColorSurchargePerColor'),
    textSurcharge: number('custom_orders.textSurcharge'),
    setupFee: number('custom_orders.setupFee'),
    setupFeeWaiverQuantity: number('custom_orders.setupFeeWaiverQuantity'),
    estimateBandBasisPoints: number('custom_orders.estimateBandPercent'),
  };
}

/**
 * The active quantity-discount tiers.
 *
 * Rows, not a setting (ADR-017): the owner edits the numbers without a deploy,
 * and `domain/discount` decides which one applies.
 */
export async function loadDiscountTiers(): Promise<readonly DiscountTier[]> {
  return prisma.discountTier.findMany({
    where: { isActive: true },
    select: { minQuantity: true, maxQuantity: true, discountBasisPoints: true },
    orderBy: { minQuantity: 'asc' },
  });
}

/* ---------------------------------------------------------------------------
 * Quotes
 * ------------------------------------------------------------------------ */

const REQUIRED_QUOTE_SETTINGS = [
  'custom_orders.depositPercent',
  'custom_orders.quoteValidityDays',
  'custom_orders.acceptanceValidityDays',
] as const;

export type QuoteSettings = {
  /** 7.4: how long an unanswered quote may be accepted. Seeded at 14. */
  quoteValidityDays: number;
  /** 7.10: how long an accepted quote stays redeemable. Seeded at 7. */
  acceptanceValidityDays: number;
  /** 5.5, basis points. 5000 = 50%. */
  depositPercentBasisPoints: number;
};

/**
 * The three numbers the quote lifecycle is measured in.
 *
 * `BUSINESS-RULES.md` 7.4 and 7.10 both say "from settings", and the phase
 * brief is explicit that neither window may be hard-coded in a component. They
 * are read here, once, and passed down as data — the same rule the rest of the
 * settings obey, including **a missing key throws**: a default of "14" invented
 * in code would silently outlive a value the owner changed in the admin.
 */
export async function loadQuoteSettings(): Promise<QuoteSettings> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...REQUIRED_QUOTE_SETTINGS] } },
    select: { key: true, value: true },
  });

  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  function number(key: (typeof REQUIRED_QUOTE_SETTINGS)[number]): number {
    const raw = byKey.get(key);
    const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);

    if (!Number.isFinite(parsed)) {
      throw new Error(`Setting ${key} is missing or not an integer. Run the seed.`);
    }
    return parsed;
  }

  return {
    quoteValidityDays: number('custom_orders.quoteValidityDays'),
    acceptanceValidityDays: number('custom_orders.acceptanceValidityDays'),
    depositPercentBasisPoints: number('custom_orders.depositPercent'),
  };
}

/**
 * The workshop's notification addresses.
 *
 * `ARCHITECTURE.md` section 11 resolves staff recipients from the
 * `notifications` settings group, so the owner changes who is told without a
 * deploy. Absent or empty is a legitimate state — a fresh deployment — and the
 * caller falls back to the bootstrap environment variable rather than throwing,
 * which is why this is the one settings reader that does not treat a missing
 * key as a misconfiguration.
 */
export async function loadStaffRecipients(): Promise<string | null> {
  const row = await prisma.setting.findUnique({
    where: { key: 'notifications.adminRecipients' },
    select: { value: true },
  });

  return row?.value ?? null;
}
