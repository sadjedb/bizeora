/**
 * Authorisation.
 *
 * Authentication answers "who is this user?" and is Better Auth's job.
 * Authorisation answers "what is this user allowed to do?" and is entirely
 * ours — Better Auth's admin and permission plugins are deliberately unused
 * (ADR-006). The two never mix: nothing in this file imports the auth library,
 * reads a cookie, or touches a database. Every function is pure over
 * `(actor, resource)`, per BUSINESS-RULES.md section 12.2.
 *
 * Phase 3 establishes the boundary and the role-level predicates that the auth
 * wrappers need. The full capability matrix in BUSINESS-RULES.md section 12.1
 * is filled in by the phases that own those resources — a permission is added
 * here when the feature that needs it is built, not in advance.
 */

import { isActive, type Actor, type Role } from '../auth/actor';

/** True when the actor is signed in, active, and holds one of `roles`. */
export function hasRole(actor: Actor, ...roles: readonly Role[]): boolean {
  return isActive(actor) && roles.includes(actor.role);
}

/** A customer acting on their own behalf. */
export function isCustomer(actor: Actor): boolean {
  return hasRole(actor, 'CUSTOMER');
}

/**
 * Staff or admin. Roles are not hierarchical (section 12.1), so this is an
 * explicit two-role check rather than a rank comparison.
 */
export function isStaff(actor: Actor): boolean {
  return hasRole(actor, 'STAFF', 'ADMIN');
}

/** Admin only: coupons, settings, shipping rates, users, audit logs. */
export function isAdmin(actor: Actor): boolean {
  return hasRole(actor, 'ADMIN');
}

/**
 * Ownership: the single most important check in the application, because it is
 * what stands between one customer and another customer's orders, quotes and
 * design files (docs/SECURITY.md section 4).
 *
 * Staff are not owners. A staff member who may read a customer's order reads it
 * through a staff capability, which is audit-logged, not by being mistaken for
 * the customer.
 */
export function ownsResource(actor: Actor, resourceUserId: string | null): boolean {
  if (resourceUserId === null) return false;
  return isActive(actor) && actor.userId === resourceUserId;
}

/**
 * Whether a verified email address is required before this actor may act.
 *
 * Verification gates commitment, not browsing: a customer must have verified
 * before accepting a quote, and not before looking at the catalogue
 * (docs/SECURITY.md section 2).
 */
export function requiresEmailVerification(
  actor: Actor,
  policy: VerificationPolicy = { required: true },
): boolean {
  // The shop can switch it off entirely (`accounts.emailVerificationRequired`).
  // When it is off, everybody counts as verified — which is the whole point: a
  // shop with no mail provider configured cannot verify anybody, and blocking
  // quote acceptance for a delivery channel that does not exist strands the
  // customer with no way forward.
  if (!policy.required) return false;

  return isActive(actor) && !actor.emailVerified;
}

/**
 * Whether the shop demands a verified address at all.
 *
 * A parameter rather than a lookup, because this file is pure and settings are
 * I/O. The caller reads `accounts.emailVerificationRequired` and passes it; the
 * default is `true`, so a call site that has not been updated stays strict
 * rather than quietly permissive.
 */
export type VerificationPolicy = { required: boolean };

/**
 * Whether this actor may accept or reject this quote.
 *
 * 12.3 and 7.5: **only** the owning customer. Staff are refused explicitly
 * rather than by omission, because `isStaff` is true for people who can see the
 * quote and an "authorised to view" check would otherwise creep into the
 * acceptance path.
 *
 * The second condition is `SECURITY.md` section 2: verification gates
 * commitment. Accepting a quote is a commercial commitment, so an unverified
 * address may look at the quote and not sign for it.
 */
export function mayRespondToQuote(
  actor: Actor,
  quoteUserId: string | null,
  policy: VerificationPolicy = { required: true },
): boolean {
  if (!isCustomer(actor)) return false;
  if (!ownsResource(actor, quoteUserId)) return false;
  return !requiresEmailVerification(actor, policy);
}

/**
 * Whether this actor may read a customer's design file.
 *
 * 12.1: "own only" for a customer, "yes" for staff and admin — and 12.5 adds
 * that every staff read is audit-logged, which is the caller's job because a
 * pure predicate cannot write one.
 */
export function mayReadDesignFile(actor: Actor, fileOwnerUserId: string | null): boolean {
  return isStaff(actor) || ownsResource(actor, fileOwnerUserId);
}

/**
 * The capability table of 12.1, for the operations Phase 12 builds.
 *
 * Each is an explicit two- or one-role check rather than a rank comparison,
 * because roles are not hierarchical: `STAFF` is not "admin with less" and
 * `ADMIN` is not "staff with more". Where the table says "staff, admin" both
 * are named; where it says admin only, only admin is.
 */

/** "Change order status", "download a design file" — staff and admin. */
export function mayManageOrders(actor: Actor): boolean {
  return isStaff(actor);
}

/** "View any customer's order" — the directory is the same capability. */
export function mayViewCustomerDirectory(actor: Actor): boolean {
  return isStaff(actor);
}

/**
 * Recording a payment.
 *
 * 8.10.4 makes this the act that moves money in the record, and 12.1 groups it
 * with changing an order's status — staff work, not an admin reserve. What is
 * admin-only is the surrounding configuration: rates, settings, coupons.
 */
export function mayRecordPayments(actor: Actor): boolean {
  return isStaff(actor);
}

/** "Read audit logs", "manage settings, users and roles" — admin only (12.1). */
export function mayReadAuditLog(actor: Actor): boolean {
  return isAdmin(actor);
}

/**
 * Changing the shop's own settings — admin only (12.1).
 *
 * Staff run the workshop; they do not decide what the shop is called, whether
 * it is open, or what a deposit is. Every one of these values is read by
 * something that prices an order or gates a security control, which is why the
 * table records who last touched each row.
 */
export function mayManageSettings(actor: Actor): boolean {
  return isAdmin(actor);
}

/**
 * Archiving records — staff and admin.
 *
 * Nothing here is deleted: archiving hides a row from the workshop's own lists
 * and changes nothing a customer can see (`domain/admin/archiving`, ADR-034).
 * A reversible, audited act of tidying is the kind of thing the people working
 * the queues do all day, so it sits with the rest of their work rather than in
 * the admin's reserve.
 */
export function mayArchiveRecords(actor: Actor): boolean {
  return isStaff(actor);
}

/**
 * The capability table of 12.1, for the operations Phase 13 builds.
 */

/** "Moderate reviews" — staff and admin, per 12.1. */
export function mayModerateReviews(actor: Actor): boolean {
  return isStaff(actor);
}

/** "Manage the gallery and content" — staff and admin, per 12.1. */
export function mayManageContent(actor: Actor): boolean {
  return isStaff(actor);
}

/**
 * Whether this actor may write a review at all.
 *
 * 11A.1 requires an authenticated customer; the *delivered purchase* half of
 * the rule is not a property of the actor and is checked against the order line
 * by `domain/review`. Staff are refused for the same reason 12.3 refuses them a
 * quote acceptance: a review is a customer's statement about their own
 * purchase, and the shop writing one under its own account is not that.
 *
 * A verified address is deliberately **not** required. `SECURITY.md` section 2
 * gates commitment on verification, and the gate that matters here is far
 * stronger — the person must have taken delivery of the product.
 */
export function mayWriteReview(actor: Actor): boolean {
  return isCustomer(actor);
}

/**
 * The capability table of 12.1, for the operations Phase 14.5 builds.
 */

/**
 * "Manage products and categories" — staff and admin, per 12.1.
 *
 * Creating, editing, publishing and archiving a product, and everything about
 * its variants, options and SKUs. Not admin-only: the workshop that photographs
 * and prices a piece is the workshop that puts it online, and reserving that
 * for a single account is how a catalogue goes stale.
 */
export function mayManageCatalogue(actor: Actor): boolean {
  return isStaff(actor);
}

/**
 * Adjusting stock on hand — the same capability as managing the catalogue.
 *
 * It is named separately because it is the one catalogue operation that can
 * silently break an order that already exists: 10.4 counts reserved units
 * against stock, so removing stock is the write that has to be refused when
 * units are spoken for. Naming it makes that check impossible to forget at the
 * call site, and gives the rule a place to move to if the business ever wants
 * a stock keeper who is not a catalogue editor.
 */
export function mayAdjustStock(actor: Actor): boolean {
  return isStaff(actor);
}
