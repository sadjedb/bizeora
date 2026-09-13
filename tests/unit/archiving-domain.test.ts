/**
 * The archiving rules, as pure functions.
 *
 * There are not many of them, and that is the finding rather than a gap: the
 * decision this feature had to get right was *not to delete*, and once a row is
 * only being hidden from a list there is almost nothing left to forbid. What
 * remains is the batch limit, the one entity whose archived-ness a customer can
 * see, and the list of kinds — all three of which are read from strings that
 * arrive from a browser, so all three are tested.
 */

import { describe, expect, it } from 'vitest';

import {
  ARCHIVABLE_ENTITIES,
  MAX_BULK_ARCHIVE,
  alwaysArchivable,
  isArchivableEntity,
  productArchivable,
  publishedRefusals,
  validateSelection,
  type ArchivableEntity,
} from '../../src/domain/admin/archiving';

describe('the kinds that can be archived', () => {
  it('names exactly the five the workshop works from as queues', () => {
    expect([...ARCHIVABLE_ENTITIES]).toEqual([
      'order',
      'request',
      'quote',
      'review',
      'product',
    ]);
  });

  it('recognises each of them', () => {
    for (const entity of ARCHIVABLE_ENTITIES) {
      expect(isArchivableEntity(entity)).toBe(true);
    }
  });

  /*
   * The entity arrives from the client and is used to pick a Prisma delegate,
   * so anything that is not on the list has to be refused rather than coerced.
   * `user` is the interesting negative: it is a real table, and archiving one
   * is exactly the thing Phase 14.6 spent a day undoing.
   */
  it.each(['user', 'order ', 'Order', 'orders', '', 'auditLog', '__proto__'])(
    'refuses %o',
    (value) => {
      expect(isArchivableEntity(value)).toBe(false);
    },
  );
});

describe('the size of one click', () => {
  it('refuses an empty selection', () => {
    expect(validateSelection([])).toBe('EMPTY');
  });

  it('accepts one row, and a full batch', () => {
    expect(validateSelection(['a'])).toBeNull();

    const full = Array.from({ length: MAX_BULK_ARCHIVE }, (_, index) => `id-${index}`);
    expect(validateSelection(full)).toBeNull();
  });

  it('refuses more than a person could have selected', () => {
    const oversized = Array.from(
      { length: MAX_BULK_ARCHIVE + 1 },
      (_, index) => `id-${index}`,
    );

    expect(validateSelection(oversized)).toBe('TOO_MANY');
  });
});

describe('a product is asked twice', () => {
  /*
   * `products.status` is customer-facing: `ARCHIVED` takes the product out of
   * the catalogue and turns its address into a 404. Archiving a *published*
   * one from a checkbox would therefore unpublish it with no more ceremony
   * than tidying a queue, so it is refused and left to the product's own
   * screen, where the button says what it does.
   */
  it('refuses a published product', () => {
    expect(productArchivable({ status: 'ACTIVE' })).toBe('PRODUCT_PUBLISHED');
  });

  it('allows a draft or an already-archived one', () => {
    expect(productArchivable({ status: 'DRAFT' })).toBeNull();
    expect(productArchivable({ status: 'ARCHIVED' })).toBeNull();
  });

  it('allows everything else unconditionally', () => {
    expect(alwaysArchivable()).toBeNull();
  });
});

describe('counting what was left alone', () => {
  it('is zero when nothing was refused', () => {
    expect(publishedRefusals({ moved: 3, refused: [] })).toBe(0);
  });

  it('counts the published products a batch skipped', () => {
    const outcome = {
      moved: 1,
      refused: [
        { id: 'a', reason: 'PRODUCT_PUBLISHED' as const },
        { id: 'b', reason: 'PRODUCT_PUBLISHED' as const },
      ],
    };

    expect(publishedRefusals(outcome)).toBe(2);
  });
});

describe('the shape the callers rely on', () => {
  it('types every entity name as an ArchivableEntity', () => {
    // A compile-time assertion with a runtime body: if the tuple and the type
    // ever drift apart this stops building before it stops passing.
    const entities: readonly ArchivableEntity[] = ARCHIVABLE_ENTITIES;
    expect(entities).toHaveLength(5);
  });
});
