'use server';

import { revalidatePath } from 'next/cache';

import { ADJUSTMENT_REASONS, type AdjustmentReason } from '@/domain/catalogue';
import { mayAdjustStock } from '@/domain/permissions';
import { LOCALES } from '@/i18n/locales';
import { requireStaff } from '@/server/auth/guards';
import { applyStockAdjustment } from '@/server/services/catalogue-admin-service';

/**
 * Moving stock.
 *
 * The payload is a variant, a **signed delta**, a reason and an optional note.
 * It is deliberately not a final quantity: a form that posts "the new total is
 * 12" silently discards whatever happened to the row since the page rendered —
 * a shipment, another operator's count — while a delta composes with them. The
 * database applies the arithmetic; this action never computes a quantity.
 *
 * Authorisation is checked here and not inherited from the layout, because a
 * server action is reachable by anybody who can POST to it. `mayAdjustStock` is
 * named separately from `mayManageCatalogue` for the reason its own comment
 * gives: this is the catalogue write that can break an order that already
 * exists.
 */

const UNAUTHENTICATED = 'Connectez-vous pour ajuster le stock.';
const FORBIDDEN = 'Vous n’avez pas accès à la gestion du stock.';

export type AdjustStockResult =
  | { ok: true; resultingQuantity: number }
  | { ok: false; message: string; field?: 'delta' | 'note' };

function isReason(value: unknown): value is AdjustmentReason {
  return (
    typeof value === 'string' && (ADJUSTMENT_REASONS as readonly string[]).includes(value)
  );
}

export async function adjustStockAction(input: {
  variantId: string;
  /** Signed. Sent as a number the client parsed; re-checked here regardless. */
  delta: number;
  reason: string;
  note: string | null;
}): Promise<AdjustStockResult> {
  const authorisation = await requireStaff();

  if (!authorisation.ok) {
    return {
      ok: false,
      message: authorisation.reason === 'UNAUTHENTICATED' ? UNAUTHENTICATED : FORBIDDEN,
    };
  }

  const actor = authorisation.actor;
  if (!mayAdjustStock(actor)) return { ok: false, message: FORBIDDEN };

  if (!isReason(input.reason)) {
    return { ok: false, message: 'Choisissez un motif.', field: 'delta' };
  }

  if (!Number.isFinite(input.delta) || !Number.isInteger(input.delta)) {
    return { ok: false, message: 'Saisissez un nombre entier.', field: 'delta' };
  }

  const note = input.note?.trim();

  const result = await applyStockAdjustment({
    variantId: input.variantId,
    delta: input.delta,
    reason: input.reason,
    note: note === undefined || note.length === 0 ? null : note,
    actorUserId: actor.userId,
  });

  if (!result.ok) return { ok: false, message: result.message, field: result.field };

  // Availability is on the product page, the shop listing and the homepage's
  // featured band, all cached for five minutes.
  revalidatePath('/admin/stock');
  revalidatePath(`/admin/products/${result.value.productId}`);
  revalidatePath('/admin');
  // One concrete path per language: the storefront's URLs carry a language and
  // sit inside route groups, which the route-pattern form does not reach.
  for (const locale of LOCALES) {
    revalidatePath(`/${locale}`);
    revalidatePath(`/${locale}/shop`);
  }

  return { ok: true, resultingQuantity: result.value.resultingQuantity };
}
