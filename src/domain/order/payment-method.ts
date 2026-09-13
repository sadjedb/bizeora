/**
 * Which payment methods an order may use.
 *
 * `ROADMAP.md` Phase 8 specifies a payment-method registry whose `supports()`
 * expresses the rule that **a custom order is not COD-eligible**: the business
 * commits materials and machine time to something it cannot resell, so it does
 * not send it out on the promise of cash on delivery. That is a domain rule,
 * not a UI preference, and it belongs here rather than in a select element.
 *
 * `BUSINESS-RULES.md` 8.10: V1 collects deposits **offline**, by bank transfer
 * or CCP, with no payment provider integrated. `ONLINE` exists in the enum
 * because the schema anticipates providers; nothing in V1 offers it, and
 * `isPrepaid` is what the deposit rule reads when one arrives.
 */

export type PaymentMethod = 'COD' | 'BANK_TRANSFER' | 'CCP' | 'ONLINE';

/** The methods V1 actually offers. `ONLINE` is deliberately absent. */
export const V1_PAYMENT_METHODS: readonly PaymentMethod[] = [
  'COD',
  'BANK_TRANSFER',
  'CCP',
];

/** 5.5: a prepaid method takes the whole total up front rather than a deposit. */
export function isPrepaid(method: PaymentMethod): boolean {
  return method === 'ONLINE';
}

/**
 * The methods available to a cart.
 *
 * An order containing a custom line cannot be COD. Everything else in V1 can.
 */
export function availablePaymentMethods(input: {
  hasCustomLine: boolean;
}): readonly PaymentMethod[] {
  return V1_PAYMENT_METHODS.filter(
    (method) => !(input.hasCustomLine && method === 'COD'),
  );
}

export function supportsPaymentMethod(
  method: PaymentMethod,
  input: { hasCustomLine: boolean },
): boolean {
  return availablePaymentMethods(input).includes(method);
}

/** 8.10: an offline method is the one that needs a transfer reference. */
export function isOfflineTransfer(method: PaymentMethod): boolean {
  return method === 'BANK_TRANSFER' || method === 'CCP';
}

/**
 * French copy for the payment methods a customer sees.
 *
 * Beside the methods themselves rather than in a page, because the order list,
 * the order detail and the checkout all name them and three copies of one
 * mapping is how "CCP" ends up written three ways.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  COD: 'Paiement à la livraison',
  BANK_TRANSFER: 'Virement bancaire',
  CCP: 'CCP',
  ONLINE: 'Paiement en ligne',
};
