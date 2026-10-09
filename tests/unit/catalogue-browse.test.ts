/**
 * The vocabulary of `/shop`'s URL.
 *
 * Every one of these functions reads or writes a query string, which is the
 * most hand-edited input the site receives: truncated by a chat app, duplicated
 * by a back button, typed by somebody guessing. So the cases here are the
 * malformed ones by design — the happy path is one line and the interesting
 * question is what a page does with `?page=-3&sort=cheapest`.
 */

import { describe, expect, it } from 'vitest';

import {
  CATALOGUE_PER_PAGE,
  DEFAULT_CATALOGUE_SORT,
  NO_CATALOGUE_QUERY,
  SEARCH_MAX,
  activeCatalogueFilterCount,
  catalogueHref,
  cataloguePageCount,
  cataloguePageWindow,
  clearedCatalogueHref,
  hasActiveCatalogueFilters,
  isDefaultCatalogueView,
  parseCatalogueQuery,
  searchTerms,
  toggleCatalogueFilter,
  withCatalogueChange,
} from '../../src/domain/catalogue/browse';

describe('reading a query string', () => {
  it('reads nothing as the default view', () => {
    expect(parseCatalogueQuery({})).toEqual(NO_CATALOGUE_QUERY);
  });

  it('reads a full one', () => {
    expect(
      parseCatalogueQuery({
        q: ' tote bag ',
        sort: 'PRICE_ASC',
        page: '3',
        customisable: '1',
        inStock: 'on',
      }),
    ).toEqual({
      q: 'tote bag',
      sort: 'PRICE_ASC',
      page: 3,
      customisable: true,
      inStock: true,
    });
  });

  /*
   * A query string is not a form the site controls. None of these should be an
   * error page; all of them should be the catalogue.
   */
  it.each([
    ['an unknown sort', { sort: 'cheapest' }],
    ['an empty sort', { sort: '' }],
    ['a repeated sort', { sort: ['NAME', 'NEWEST'] }],
  ])('falls back to the default order given %s', (_label, params) => {
    expect(parseCatalogueQuery(params).sort).toBe(DEFAULT_CATALOGUE_SORT);
  });

  it.each([
    ['zero', '0'],
    ['a negative', '-3'],
    ['a decimal', '1.5'],
    ['a word', 'deux'],
    ['nothing', ''],
  ])('falls back to page 1 given %s', (_label, page) => {
    expect(parseCatalogueQuery({ page }).page).toBe(1);
  });

  it('keeps a page number it can use', () => {
    expect(parseCatalogueQuery({ page: '7' }).page).toBe(7);
  });

  it('treats a repeated or blank search as no search', () => {
    expect(parseCatalogueQuery({ q: ['a', 'b'] }).q).toBeNull();
    expect(parseCatalogueQuery({ q: '   ' }).q).toBeNull();
  });

  it('cuts a pasted search rather than refusing it', () => {
    const long = 'x'.repeat(SEARCH_MAX + 50);
    expect(parseCatalogueQuery({ q: long }).q).toHaveLength(SEARCH_MAX);
  });

  /*
   * `?customisable=0` is how somebody writes "off" by hand, and a checkbox that
   * is not ticked sends nothing at all. Both have to mean the same thing.
   */
  it.each([
    ['on', true],
    ['1', true],
    ['true', true],
    ['yes', true],
    ['0', false],
    ['false', false],
  ])('reads customisable=%s as %s', (value, expected) => {
    expect(parseCatalogueQuery({ customisable: value }).customisable).toBe(expected);
  });

  it('reads an absent flag as off', () => {
    expect(parseCatalogueQuery({}).customisable).toBe(false);
    expect(parseCatalogueQuery({}).inStock).toBe(false);
  });
});

describe('what counts as narrowed', () => {
  it('counts the filters and not the presentation', () => {
    const filtered = { ...NO_CATALOGUE_QUERY, q: 'tote', inStock: true };

    expect(hasActiveCatalogueFilters(filtered)).toBe(true);
    expect(activeCatalogueFilterCount(filtered)).toBe(2);

    const reordered = { ...NO_CATALOGUE_QUERY, sort: 'NAME' as const, page: 4 };

    expect(hasActiveCatalogueFilters(reordered)).toBe(false);
    expect(activeCatalogueFilterCount(reordered)).toBe(0);
  });

  /*
   * The indexing rule is stricter than the filter count: an order and a page
   * are both views of the one listing, so neither is the listing itself.
   */
  it('indexes only the listing itself', () => {
    expect(isDefaultCatalogueView(NO_CATALOGUE_QUERY)).toBe(true);

    expect(isDefaultCatalogueView({ ...NO_CATALOGUE_QUERY, q: 'tote' })).toBe(false);
    expect(isDefaultCatalogueView({ ...NO_CATALOGUE_QUERY, sort: 'NAME' })).toBe(false);
    expect(isDefaultCatalogueView({ ...NO_CATALOGUE_QUERY, page: 2 })).toBe(false);
    expect(isDefaultCatalogueView({ ...NO_CATALOGUE_QUERY, inStock: true })).toBe(false);
  });
});

describe('writing the next URL', () => {
  it('writes nothing for the default view', () => {
    expect(catalogueHref('/shop', NO_CATALOGUE_QUERY)).toBe('/shop');
    expect(catalogueHref('/shop/c/polos', NO_CATALOGUE_QUERY)).toBe('/shop/c/polos');
  });

  /*
   * A default written down is a second URL for the same page, and then a
   * canonical tag to explain it away. Leaving it out is cheaper than both.
   */
  it('leaves the defaults out', () => {
    expect(
      catalogueHref('/shop', {
        ...NO_CATALOGUE_QUERY,
        sort: DEFAULT_CATALOGUE_SORT,
        page: 1,
      }),
    ).toBe('/shop');
  });

  it('writes what is not the default', () => {
    expect(
      catalogueHref('/shop', {
        q: 'tote bag',
        sort: 'PRICE_DESC',
        page: 2,
        customisable: true,
        inStock: false,
      }),
    ).toBe('/shop?q=tote+bag&sort=PRICE_DESC&customisable=1&page=2');
  });

  it('toggles one filter and leaves the rest alone', () => {
    const query = { ...NO_CATALOGUE_QUERY, q: 'polo', inStock: true };

    expect(toggleCatalogueFilter('/shop', query, 'customisable')).toBe(
      '/shop?q=polo&customisable=1&inStock=1',
    );
    expect(toggleCatalogueFilter('/shop', query, 'inStock')).toBe('/shop?q=polo');
  });

  /*
   * Page 4 of everything is rarely page 4 of a narrower thing, and landing on
   * an empty page after ticking a box reads as a broken filter.
   */
  it('returns to the first page whenever anything but the page changes', () => {
    const deep = { ...NO_CATALOGUE_QUERY, page: 4 };

    expect(withCatalogueChange(deep, { q: 'tote' }).page).toBe(1);
    expect(withCatalogueChange(deep, { sort: 'NAME' }).page).toBe(1);
    expect(withCatalogueChange(deep, { page: 5 }).page).toBe(5);
  });

  it('clears the filters but keeps the chosen order', () => {
    const query = {
      q: 'tote',
      sort: 'PRICE_ASC' as const,
      page: 3,
      customisable: true,
      inStock: true,
    };

    expect(clearedCatalogueHref('/shop', query)).toBe('/shop?sort=PRICE_ASC');
  });
});

describe('pages', () => {
  it('is one page when there is nothing', () => {
    expect(cataloguePageCount(0)).toBe(1);
  });

  it('counts partial pages', () => {
    expect(cataloguePageCount(CATALOGUE_PER_PAGE)).toBe(1);
    expect(cataloguePageCount(CATALOGUE_PER_PAGE + 1)).toBe(2);
    expect(cataloguePageCount(CATALOGUE_PER_PAGE * 3)).toBe(3);
  });

  it('draws every page when there are few', () => {
    expect(cataloguePageWindow(1, 1)).toEqual([1]);
    expect(cataloguePageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(cataloguePageWindow(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  /*
   * `null` is the gap. A row of forty page links is a row nobody reads and
   * forty links a crawler follows.
   */
  it('windows around the current page when there are many', () => {
    expect(cataloguePageWindow(1, 20)).toEqual([1, 2, 3, null, 20]);
    expect(cataloguePageWindow(10, 20)).toEqual([1, null, 8, 9, 10, 11, 12, null, 20]);
    expect(cataloguePageWindow(20, 20)).toEqual([1, null, 18, 19, 20]);
  });

  it('never repeats the first or last page', () => {
    const window = cataloguePageWindow(2, 20);
    const numbers = window.filter((page): page is number => page !== null);

    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe('search terms', () => {
  /*
   * "tote toile" has to find "Tote bag en toile écrue", which one `LIKE` of the
   * whole phrase cannot. Each word is its own condition.
   */
  it('splits on whitespace', () => {
    expect(searchTerms('tote toile')).toEqual(['tote', 'toile']);
    expect(searchTerms('  tote   bag  ')).toEqual(['tote', 'bag']);
  });

  it('is empty for a blank term', () => {
    expect(searchTerms('   ')).toEqual([]);
  });

  it('caps how many conditions one search can produce', () => {
    expect(searchTerms('a b c d e f g h i j')).toHaveLength(6);
  });
});
