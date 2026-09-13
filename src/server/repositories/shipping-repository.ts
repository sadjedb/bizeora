import 'server-only';

import { prisma } from '@/lib/db/client';
import type { ApplicableRate, DeliveryType } from '@/domain/shipping';

/**
 * Shipping reference data.
 *
 * `BUSINESS-RULES.md` 4.1 resolves a zone from a wilaya and a rate from the
 * zone. Both lookups are queries; the arithmetic that follows them is
 * `domain/shipping`. This module returns rows and never decides an amount.
 *
 * The `wilayaCode` is globally unique in `shipping_zone_wilayas`
 * (`DATABASE.md` section 14), so "the zone for a wilaya" is a single row by
 * construction rather than a first-match.
 */

export type WilayaOption = { code: number; name: string };

/**
 * Every wilaya the shop delivers to, for the checkout selector.
 *
 * Only mapped wilayas are returned. 4.4 requires an unmapped wilaya to block
 * checkout with an explicit message rather than silently defaulting to a rate —
 * and the cleanest way to honour that is not to offer it, while the server
 * still refuses one that arrives in a payload anyway.
 */
export async function listServedWilayas(): Promise<readonly WilayaOption[]> {
  const rows = await prisma.wilaya.findMany({
    where: {
      isActive: true,
      zoneWilaya: { zone: { isActive: true, rates: { some: { isActive: true } } } },
    },
    select: { code: true, nameFr: true },
    orderBy: { code: 'asc' },
  });

  return rows.map((row) => ({ code: row.code, name: row.nameFr }));
}

/**
 * The active rates offered for a wilaya, both delivery types.
 *
 * Returns an empty array for an unmapped or unserved wilaya, which
 * `domain/shipping.selectRate` turns into `WILAYA_NOT_SERVED`.
 */
export async function ratesForWilaya(
  wilayaCode: number,
): Promise<readonly ApplicableRate[]> {
  const mapping = await prisma.shippingZoneWilaya.findUnique({
    where: { wilayaCode },
    select: {
      zone: {
        select: {
          name: true,
          isActive: true,
          rates: {
            where: { isActive: true },
            select: {
              id: true,
              deliveryType: true,
              price: true,
              freeOverAmount: true,
              estimatedMinDays: true,
              estimatedMaxDays: true,
            },
          },
        },
      },
    },
  });

  if (!mapping || !mapping.zone.isActive) return [];

  return mapping.zone.rates.map((rate) => ({
    id: rate.id,
    deliveryType: rate.deliveryType as DeliveryType,
    price: rate.price,
    freeOverAmount: rate.freeOverAmount,
    estimatedMinDays: rate.estimatedMinDays,
    estimatedMaxDays: rate.estimatedMaxDays,
    zoneName: mapping.zone.name,
  }));
}

/** Whether a wilaya exists and is active — checked before anything else. */
export async function wilayaExists(wilayaCode: number): Promise<boolean> {
  const wilaya = await prisma.wilaya.findFirst({
    where: { code: wilayaCode, isActive: true },
    select: { code: true },
  });

  return wilaya !== null;
}

/** The wilaya's own name, for the address snapshot ("Alger", not "Nord"). */
export async function wilayaName(wilayaCode: number): Promise<string | null> {
  const wilaya = await prisma.wilaya.findFirst({
    where: { code: wilayaCode, isActive: true },
    select: { nameFr: true },
  });

  return wilaya?.nameFr ?? null;
}
