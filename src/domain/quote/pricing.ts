import { err, ok, type Result } from '../result';

/**
 * Quote pricing.
 *
 * `BUSINESS-RULES.md` 2.6. A quote is priced by an admin from line items — the
 * system suggests a set derived from the configuration and the admin may change
 * every value (2.6.1). That makes this module's job unusual for the project:
 * the numbers *originate* with a person rather than being derived from rows.
 *
 * What is not negotiable is how they add up. 2.6.2:
 *
 *     subtotal      = sum(positive lines)      // not DISCOUNT, not SHIPPING
 *     discountTotal = abs(sum(DISCOUNT lines))
 *     shippingTotal = sum(SHIPPING lines)
 *     grandTotal    = subtotal - discountTotal + shippingTotal + taxTotal
 *
 * The admin supplies lines; this supplies the totals. There is no path by which
 * a total is typed in, which is why `quoteTotals` takes lines and nothing else.
 */

export type QuoteLineKind =
  | 'PRODUCT'
  | 'EMBROIDERY'
  | 'SETUP_FEE'
  | 'DIGITIZING'
  | 'RUSH_FEE'
  | 'SHIPPING'
  | 'DISCOUNT'
  | 'OTHER';

export const QUOTE_LINE_KINDS: readonly QuoteLineKind[] = [
  'PRODUCT',
  'EMBROIDERY',
  'SETUP_FEE',
  'DIGITIZING',
  'RUSH_FEE',
  'SHIPPING',
  'DISCOUNT',
  'OTHER',
];

/** 2.6.5: these become `FEE` order items, one each, quantity 1. */
export const FEE_LINE_KINDS: readonly QuoteLineKind[] = [
  'SETUP_FEE',
  'DIGITIZING',
  'RUSH_FEE',
  'OTHER',
];

export type QuoteLineInput = {
  kind: QuoteLineKind;
  label: string;
  quantity: number;
  /** Integer minor units (ADR-012). Negative only for `DISCOUNT`. */
  unitPrice: number;
};

export type QuoteTotals = {
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
};

export type QuoteLineError = {
  code:
    | 'NON_INTEGER_AMOUNT'
    | 'INVALID_QUANTITY'
    | 'NEGATIVE_PRICE'
    | 'DISCOUNT_MUST_BE_NEGATIVE'
    | 'MISSING_LABEL'
    | 'MULTI_QUANTITY_FEE';
  index: number;
};

/** `quote_items.lineTotal`, and the check constraint on the column. */
export function quoteLineTotal(line: QuoteLineInput): number {
  return line.unitPrice * line.quantity;
}

/**
 * Every line, checked.
 *
 * The sign rules are the ones the schema also enforces: `unitPrice` may be
 * negative **only** on a `DISCOUNT` line, and a `DISCOUNT` line that is not
 * negative is a discount that adds money, which is a typo with consequences.
 */
export function validateQuoteLines(
  lines: readonly QuoteLineInput[],
): Result<readonly QuoteLineInput[], QuoteLineError> {
  for (const [index, line] of lines.entries()) {
    if (!Number.isInteger(line.unitPrice) || !Number.isInteger(line.quantity)) {
      return err({ code: 'NON_INTEGER_AMOUNT' as const, index });
    }

    if (line.label.trim() === '') return err({ code: 'MISSING_LABEL' as const, index });

    if (line.quantity < 1) return err({ code: 'INVALID_QUANTITY' as const, index });

    if (line.kind === 'DISCOUNT') {
      if (line.unitPrice >= 0) {
        return err({ code: 'DISCOUNT_MUST_BE_NEGATIVE' as const, index });
      }
    } else if (line.unitPrice < 0) {
      return err({ code: 'NEGATIVE_PRICE' as const, index });
    }

    // 2.6.5 maps each fee to exactly one order item with `quantity = 1`, and
    // the order-item check constraint enforces it. A fee quoted at quantity 3
    // could not survive acceptance, so it is refused here where the admin can
    // still see what they typed.
    if (FEE_LINE_KINDS.includes(line.kind) && line.quantity !== 1) {
      return err({ code: 'MULTI_QUANTITY_FEE' as const, index });
    }
  }

  return ok(lines);
}

/** 2.6.2. Totals are derived from lines and never supplied. */
export function quoteTotals(lines: readonly QuoteLineInput[], taxTotal = 0): QuoteTotals {
  let subtotal = 0;
  let discountTotal = 0;
  let shippingTotal = 0;

  for (const line of lines) {
    const total = quoteLineTotal(line);

    if (line.kind === 'DISCOUNT') {
      // Stored as a positive magnitude, as `orders.discountTotal` is.
      discountTotal += Math.abs(total);
    } else if (line.kind === 'SHIPPING') {
      shippingTotal += total;
    } else {
      subtotal += total;
    }
  }

  return {
    subtotal,
    discountTotal,
    shippingTotal,
    taxTotal,
    grandTotal: subtotal - discountTotal + shippingTotal + taxTotal,
  };
}

export type SendabilityError = {
  code: 'NO_LINES' | 'NON_POSITIVE_TOTAL' | 'VALID_UNTIL_IN_THE_PAST' | 'ONLY_FEE_LINES';
};

/**
 * 2.6.3: a quote cannot be sent with no lines, with `grandTotal <= 0`, or with
 * a `validUntil` in the past.
 *
 * The fourth check is ours: a quote of **pure fees** prices nothing the
 * customer receives. A `SETUP_FEE` or a `DIGITIZING` line becomes a `FEE` order
 * item — quantity 1, no configuration, nothing to make (ADR-025) — so a quote
 * built only from those would produce an order with no work in it.
 *
 * That question is `hasProductionLine`, and asking it here is the fix to a real
 * defect: this check used to demand a line of kind `PRODUCT` specifically, so
 * an embroidery shop that priced its work as `EMBROIDERY` — the obvious choice,
 * and the one the editor offers directly beneath `PRODUCT` — could save a draft
 * and never send it. 2.6.5 maps `EMBROIDERY` to its own `CUSTOM` order item
 * exactly as it maps `PRODUCT`, so nothing downstream ever cared about the
 * difference.
 */
export function validateSendable(input: {
  lines: readonly QuoteLineInput[];
  totals: QuoteTotals;
  validUntil: Date;
  now?: Date;
}): Result<true, SendabilityError> {
  const now = input.now ?? new Date();

  if (input.lines.length === 0) return err({ code: 'NO_LINES' as const });
  if (input.totals.grandTotal <= 0) return err({ code: 'NON_POSITIVE_TOTAL' as const });
  if (input.validUntil.getTime() <= now.getTime()) {
    return err({ code: 'VALID_UNTIL_IN_THE_PAST' as const });
  }
  if (!hasProductionLine(input.lines)) {
    return err({ code: 'ONLY_FEE_LINES' as const });
  }

  return ok(true);
}

/**
 * Whether the quote prices anything that has to be made.
 *
 * Drives the deposit (5.5: an order with no custom line has none) and the
 * payment methods offered (a custom order is never cash on delivery). A quote
 * exists because something is being made to order, so this is true whenever a
 * `PRODUCT` or `EMBROIDERY` line is present.
 */
export function hasProductionLine(lines: readonly QuoteLineInput[]): boolean {
  return lines.some((line) => line.kind === 'PRODUCT' || line.kind === 'EMBROIDERY');
}

export const QUOTE_LINE_ERROR_LABELS: Record<QuoteLineError['code'], string> = {
  NON_INTEGER_AMOUNT: 'Les montants doivent être des nombres entiers de centimes.',
  INVALID_QUANTITY: 'La quantité doit être d’au moins 1.',
  NEGATIVE_PRICE: 'Seule une ligne de remise peut être négative.',
  DISCOUNT_MUST_BE_NEGATIVE: 'Une ligne de remise doit être négative.',
  MISSING_LABEL: 'Chaque ligne doit porter un libellé.',
  MULTI_QUANTITY_FEE: 'Un frais est facturé une seule fois : quantité 1.',
};

export const SENDABILITY_ERROR_LABELS: Record<SendabilityError['code'], string> = {
  NO_LINES: 'Un devis doit comporter au moins une ligne.',
  NON_POSITIVE_TOTAL: 'Le total du devis doit être supérieur à zéro.',
  VALID_UNTIL_IN_THE_PAST: 'La date de validité doit être dans le futur.',
  ONLY_FEE_LINES:
    'Un devis doit comporter au moins une ligne « Article » ou « Broderie ». Un devis composé ' +
    'uniquement de frais ne peut pas être commandé.',
};

/** French copy for the line kinds, shown on the quote and in the editor. */
export const QUOTE_LINE_KIND_LABELS: Record<QuoteLineKind, string> = {
  PRODUCT: 'Article',
  EMBROIDERY: 'Broderie',
  SETUP_FEE: 'Frais de préparation',
  DIGITIZING: 'Numérisation',
  RUSH_FEE: 'Supplément urgence',
  SHIPPING: 'Livraison',
  DISCOUNT: 'Remise',
  OTHER: 'Autre',
};
