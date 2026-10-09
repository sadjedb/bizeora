/**
 * The overlay that makes the catalogue bilingual.
 *
 * Two properties carry the whole design and are worth stating before the cases:
 * **French is the fallback**, so a field the overlay does not mention keeps its
 * French value rather than going blank; and **the caller names the fields**, so
 * an overlay written into the column cannot reach a price or a status by being
 * present. Most of what follows is one of those two, from a different angle.
 */

import { describe, expect, it } from 'vitest';

import {
  TRANSLATABLE_FIELDS,
  isTranslatableLocale,
  localise,
  mergeTranslation,
  translationFor,
  translationProgress,
  validateTranslation,
} from '../../src/domain/translation';

const PRODUCT = {
  slug: 't-shirt-brode',
  name: 'T-shirt brodé',
  description: 'Coton peigné.',
  basePrice: 4800,
  status: 'ACTIVE',
};

const OVERLAY = { en: { name: 'Embroidered t-shirt' } };

describe('reading an overlay', () => {
  it('returns nothing for the source language', () => {
    // French lives in the row's own columns; there is never an `fr` overlay.
    expect(translationFor({ fr: { name: 'Autre' } }, 'fr')).toEqual({});
  });

  it('returns the fields for another language', () => {
    expect(translationFor(OVERLAY, 'en')).toEqual({ name: 'Embroidered t-shirt' });
  });

  /*
   * Whitespace is not a translation. "Opened the box and left it empty" has to
   * mean "not translated", or clearing a field would blank the French out.
   */
  it.each([
    ['an empty string', { en: { name: '' } }],
    ['whitespace', { en: { name: '   ' } }],
    ['a number', { en: { name: 42 } }],
    ['null', { en: { name: null } }],
  ])('ignores %s', (_label, overlay) => {
    expect(translationFor(overlay, 'en')).toEqual({});
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', [{ name: 'x' }]],
    ['a string', 'en'],
    ['a locale that is not an object', { en: 'Embroidered t-shirt' }],
  ])('survives %s in the column', (_label, value) => {
    expect(translationFor(value, 'en')).toEqual({});
  });
});

describe('localising a row', () => {
  it('replaces the fields it is given', () => {
    const row = localise(PRODUCT, OVERLAY, 'en', ['name']);

    expect(row.name).toBe('Embroidered t-shirt');
  });

  it('keeps French for anything the overlay does not mention', () => {
    const row = localise(PRODUCT, OVERLAY, 'en', ['name', 'description']);

    expect(row.description).toBe('Coton peigné.');
  });

  /*
   * The important one. The overlay is a JSON column an admin form writes; if
   * `localise` merged whatever it found, a crafted overlay would be a way to
   * set a price.
   */
  it('cannot reach a field the caller did not name', () => {
    const hostile = { en: { name: 'X', basePrice: 1, status: 'DRAFT' } };
    const row = localise(PRODUCT, hostile, 'en', ['name']);

    expect(row.basePrice).toBe(4800);
    expect(row.status).toBe('ACTIVE');
  });

  it('returns the row itself when there is nothing to do', () => {
    expect(localise(PRODUCT, null, 'en', ['name'])).toBe(PRODUCT);
    expect(localise(PRODUCT, OVERLAY, 'fr', ['name'])).toBe(PRODUCT);
  });

  it('knows which locales may carry an overlay', () => {
    expect(isTranslatableLocale('en')).toBe(true);
    expect(isTranslatableLocale('fr')).toBe(false);
    expect(isTranslatableLocale('de')).toBe(false);
  });
});

describe('validating a submission', () => {
  it('accepts what fits', () => {
    expect(validateTranslation('product', { name: 'Embroidered t-shirt' })).toEqual({});
  });

  it('refuses a field that is not translatable', () => {
    expect(validateTranslation('product', { basePrice: '1' })).toEqual({
      basePrice: 'UNKNOWN_FIELD',
    });
  });

  it('refuses a value longer than the French column allows', () => {
    const max = TRANSLATABLE_FIELDS.product.name;

    expect(validateTranslation('product', { name: 'x'.repeat(max) })).toEqual({});
    expect(validateTranslation('product', { name: 'x'.repeat(max + 1) })).toEqual({
      name: 'TOO_LONG',
    });
  });

  it('reports every bad field at once', () => {
    expect(
      validateTranslation('category', {
        name: 'x'.repeat(200),
        description: 'fine',
        slug: 'nope',
      }),
    ).toEqual({ name: 'TOO_LONG', slug: 'UNKNOWN_FIELD' });
  });
});

describe('merging a submission into the column', () => {
  it('writes a new overlay', () => {
    expect(mergeTranslation(null, 'en', 'product', { name: 'Tote bag' })).toEqual({
      en: { name: 'Tote bag' },
    });
  });

  it('replaces what is there without touching the rest', () => {
    const existing = { en: { name: 'Old', description: 'Kept' } };

    expect(
      mergeTranslation(existing, 'en', 'product', { name: 'New', description: 'Kept' }),
    ).toEqual({ en: { name: 'New', description: 'Kept' } });
  });

  /*
   * Clearing a box means "show the French again", never "show nothing". This is
   * the same distinction `translationFor` makes when reading, enforced on the
   * way in so the column never stores a blank.
   */
  it('removes a field that was cleared', () => {
    const existing = { en: { name: 'Old', description: 'Gone' } };

    expect(
      mergeTranslation(existing, 'en', 'product', { name: 'Old', description: '  ' }),
    ).toEqual({ en: { name: 'Old' } });
  });

  it('collapses to null once the last field is cleared', () => {
    const existing = { en: { name: 'Old' } };

    expect(mergeTranslation(existing, 'en', 'product', { name: '' })).toBeNull();
  });

  /*
   * The form edits one language at a time. Saving English must not be a way to
   * lose a language that was not on the screen.
   */
  it('leaves other locales alone', () => {
    const existing = { en: { name: 'English' }, de: { name: 'Deutsch' } };

    expect(mergeTranslation(existing, 'en', 'product', { name: 'Changed' })).toEqual({
      de: { name: 'Deutsch' },
      en: { name: 'Changed' },
    });
  });

  it('drops a field the kind does not allow', () => {
    expect(
      mergeTranslation(null, 'en', 'category', { name: 'Bags', basePrice: '1' }),
    ).toEqual({ en: { name: 'Bags' } });
  });
});

describe('how much is translated', () => {
  /*
   * Not a boolean. A product with an English name and no English description is
   * genuinely half done, and a screen that says "no" hides the work already
   * spent.
   */
  it('counts only the fields that have something to translate', () => {
    const row = { name: 'T-shirt brodé', description: 'Coton.', material: null };

    expect(
      translationProgress({ row, translations: OVERLAY, locale: 'en', kind: 'product' }),
    ).toEqual({ done: 1, total: 2 });
  });

  it('is complete when nothing is owed', () => {
    expect(
      translationProgress({ row: {}, translations: null, locale: 'en', kind: 'product' }),
    ).toEqual({ done: 0, total: 0 });
  });
});
