/**
 * Taking a row off the workshop's screens.
 *
 * Until now nothing in the admin could be cleared. Requests that went nowhere,
 * quotes that were refused, orders from a day of testing — all of them stayed
 * in the queue for ever, and the only way to remove one was a SQL client. The
 * obvious answer is a delete button, and it is the wrong one:
 *
 *   - **an order is a receipt.** A shop that can erase the record of money it
 *     took has no books, and the customer's own order page would 404 on a link
 *     they were e-mailed;
 *   - **a request is a customer's words**, and a quote is a price somebody was
 *     offered. Deleting them makes the shop's side of a conversation disappear
 *     from a conversation the other party still remembers;
 *   - **`ON DELETE SET NULL` is patient.** Phase 14.6 spent a day cleaning up
 *     179 orders orphaned by deleting the users that owned them. A delete
 *     button on a list is that mistake with a nicer interface.
 *
 * So archiving is what this is: **the row is hidden from the admin's lists and
 * from nothing else.** The customer still sees their order, the payment totals
 * still count it, the history is intact, and one click puts it back. Nothing
 * here is irreversible, which is why it is a staff capability rather than an
 * admin reserve.
 *
 * Pure: what may be archived, and how many at once. Where the flag is stored is
 * the repository's problem, and it differs — an order, a request, a quote and a
 * review carry `archived_at`; a product archives through its own status,
 * because for a product "archived" already means something customers can see.
 */

export const ARCHIVABLE_ENTITIES = [
  'order',
  'request',
  'quote',
  'review',
  'product',
] as const;

export type ArchivableEntity = (typeof ARCHIVABLE_ENTITIES)[number];

export function isArchivableEntity(value: string): value is ArchivableEntity {
  return (ARCHIVABLE_ENTITIES as readonly string[]).includes(value);
}

/**
 * How many rows one click may move.
 *
 * The lists page at fifty, so a hundred covers "select everything on two pages"
 * and refuses a payload that no sequence of clicks could have produced.
 */
export const MAX_BULK_ARCHIVE = 100;

export type SelectionRefusal = 'EMPTY' | 'TOO_MANY';

export function validateSelection(ids: readonly string[]): SelectionRefusal | null {
  if (ids.length === 0) return 'EMPTY';
  if (ids.length > MAX_BULK_ARCHIVE) return 'TOO_MANY';

  return null;
}

/* ---------------------------------------------------------------------------
 * The one rule that is not "yes"
 * ------------------------------------------------------------------------ */

export type ArchiveRefusal = 'PRODUCT_PUBLISHED';

/**
 * A product leaves the shop when it is archived, so it is asked twice.
 *
 * The other four are queue hygiene and nothing else can tell. `products.status`
 * is customer-facing: `ARCHIVED` removes the product from the catalogue and
 * makes its address a 404 (11.6). Archiving a *published* product from a
 * checkbox on a list would take a live product off the shop with no more
 * ceremony than tidying a queue, so it is refused here and left to the
 * product's own screen, where the button says what it does.
 *
 * A draft is fair game: nobody can see it.
 */
export function productArchivable(product: { status: string }): ArchiveRefusal | null {
  return product.status === 'ACTIVE' ? 'PRODUCT_PUBLISHED' : null;
}

/**
 * Everything else may be archived, in any state.
 *
 * Deliberately unconditional. The reason a delete needs a table of rules is
 * that it destroys something; hiding a row from a list destroys nothing, and a
 * rule like "you may not archive an order in production" would only stop
 * somebody tidying a screen — the order would still be in production, still be
 * on the dashboard's own queues, and still be one click from coming back.
 */
export function alwaysArchivable(): null {
  return null;
}

/* ---------------------------------------------------------------------------
 * Outcomes
 * ------------------------------------------------------------------------ */

export type ArchiveOutcome = {
  /** How many rows changed. */
  moved: number;
  /** Rows the rules kept where they were, with the reason. */
  refused: readonly { id: string; reason: ArchiveRefusal }[];
};

/** How many of a batch's refusals were the one refusal there is. */
export function publishedRefusals(outcome: ArchiveOutcome): number {
  return outcome.refused.filter((row) => row.reason === 'PRODUCT_PUBLISHED').length;
}
