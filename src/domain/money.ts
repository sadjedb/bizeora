/**
 * Money and percentages.
 *
 * `BUSINESS-RULES.md` section 1: money is an integer of minor units, never a
 * float (ADR-012). Section 1.6: every percentage in a business calculation is
 * an integer count of basis points, where 10 000 = 100% (ADR-018).
 *
 * `applyBasisPoints` is *the* conversion, and section 1.6 is explicit that it
 * exists once. Two coexisting conventions in one codebase is how a deposit ends
 * up charged at 0.5% or at 5000% of an order.
 */

export const BASIS_POINTS_SCALE = 10_000;

/**
 * Round half away from zero.
 *
 * `Math.round` rounds half *up* on the number line, so it turns −0.5 into −0,
 * which makes a discount and its reversal disagree by one minor unit. Money is
 * symmetric; rounding must be too.
 */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * A percentage of an amount, in minor units.
 *
 * Rounded once, here. A caller that rounds again is compounding error; a caller
 * that does the multiplication itself is the second implementation section 1.6
 * exists to prevent.
 */
export function applyBasisPoints(amount: number, basisPoints: number): number {
  return roundHalfUp((amount * basisPoints) / BASIS_POINTS_SCALE);
}
