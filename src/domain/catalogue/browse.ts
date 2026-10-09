/**
 * How a visitor narrows the catalogue.
 *
 * Search, sort, two filters and a page number — as a URL, never as component
 * state. Everything here is the vocabulary of that URL: what may be in it, what
 * a missing or malformed value means, and how to write the next one.
 *
 * ## Why this is a domain module and not a hook
 *
 * `/shop` is a page a customer sends to somebody. "Here, these are the ones I
 * meant" has to survive being pasted into WhatsApp, and a filter held in React
 * state does not. Once the state is a URL, the parsing has to be forgiving —
 * a query string is user input and arrives truncated, duplicated (`?page=1&page=2`)
 * and hand-edited — and forgiving parsing is exactly the kind of logic that
 * belongs in a pure function with tests rather than inline in a page.
 *
 * The same functions serve `/shop` and `/shop/c/[category]`: the category is
 * part of the *path* there rather than the query, which is why `catalogueHref`
 * takes the base path as an argument.
 *
 * Pure. No I/O, no Prisma, no framework.
 */

/* ---------------------------------------------------------------------------
 * The shape of a request
 * ------------------------------------------------------------------------ */

/**
 * The orders the catalogue can be read in.
 *
 * Four, and no more: every one has to be a `ORDER BY` the database can serve
 * from an index, and every one has to mean something to somebody shopping.
 * "Relevance" is deliberately absent — it would need a ranking function, and a
 * search that silently reorders by a score nobody can see is worse than one
 * that says "newest first".
 */
export const CATALOGUE_SORTS = ['NEWEST', 'PRICE_ASC', 'PRICE_DESC', 'NAME'] as const;

export type CatalogueSort = (typeof CATALOGUE_SORTS)[number];

export const DEFAULT_CATALOGUE_SORT: CatalogueSort = 'NEWEST';

/**
 * How many products a page holds.
 *
 * Twelve rather than the repository's bound of 24, because the grid is three or
 * four across: twelve fills four rows on a desktop and is a short scroll on a
 * phone. It is also small enough that the second page exists at all, which is
 * the only way the pagination is ever tested by real use.
 */
export const CATALOGUE_PER_PAGE = 12;

/** Longer than this is not a search, it is a paste. */
export const SEARCH_MAX = 80;

export type CatalogueQuery = {
  /** The search term, trimmed, or `null` when there is none. */
  q: string | null;
  sort: CatalogueSort;
  /** 1-based. Always at least 1. */
  page: number;
  /** Only products that accept embroidery. */
  customisable: boolean;
  /** Only products somebody could buy today. */
  inStock: boolean;
};

export const NO_CATALOGUE_QUERY: CatalogueQuery = {
  q: null,
  sort: DEFAULT_CATALOGUE_SORT,
  page: 1,
  customisable: false,
  inStock: false,
};

/* ---------------------------------------------------------------------------
 * Reading one out of a query string
 * ------------------------------------------------------------------------ */

function single(value: string | string[] | undefined): string | null {
  // `?q=a&q=b` arrives as an array. Taking the first would be a guess; treating
  // it as absent is the answer the empty state can explain.
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function isSort(value: string | null): value is CatalogueSort {
  return value !== null && (CATALOGUE_SORTS as readonly string[]).includes(value);
}

/**
 * Read a request out of `searchParams`.
 *
 * **Nothing here throws and nothing 404s.** A query string is the most
 * hand-edited input a site receives, and a visitor who mangles one should land
 * on the catalogue, not on an error. So an unknown sort becomes the default, a
 * page number that is not a positive integer becomes 1, and a search longer
 * than `SEARCH_MAX` is cut rather than refused.
 *
 * The flags are read as "present and not `0`", which is what a checkbox in a
 * `GET` form sends and what a hand-written `?customisable=1` means.
 */
export function parseCatalogueQuery(params: {
  q?: string | string[] | undefined;
  sort?: string | string[] | undefined;
  page?: string | string[] | undefined;
  customisable?: string | string[] | undefined;
  inStock?: string | string[] | undefined;
}): CatalogueQuery {
  const sort = single(params.sort);
  const term = single(params.q);

  return {
    q: term === null ? null : term.slice(0, SEARCH_MAX),
    sort: isSort(sort) ? sort : DEFAULT_CATALOGUE_SORT,
    page: parsePage(single(params.page)),
    customisable: isOn(single(params.customisable)),
    inStock: isOn(single(params.inStock)),
  };
}

function parsePage(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return 1;

  const parsed = Number.parseInt(value, 10);
  // A page number beyond the catalogue is clamped by the caller, which knows
  // how many pages there are. This only rejects what is not a page number.
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function isOn(value: string | null): boolean {
  return value !== null && value !== '0' && value !== 'false';
}

/* ---------------------------------------------------------------------------
 * Asking about one
 * ------------------------------------------------------------------------ */

/**
 * Whether the visitor has narrowed anything.
 *
 * **The sort and the page do not count**, and the distinction matters twice
 * over. It decides whether the page says "24 pièces" or "8 pièces sur 24", and
 * it decides nothing about indexing — `isDefaultCatalogueView` is the predicate
 * for that, and it is stricter.
 */
export function hasActiveCatalogueFilters(query: CatalogueQuery): boolean {
  return query.q !== null || query.customisable || query.inStock;
}

/** How many filters are on, for the count `UX.md` section 4 asks to be visible. */
export function activeCatalogueFilterCount(query: CatalogueQuery): number {
  return (
    (query.q !== null ? 1 : 0) + (query.customisable ? 1 : 0) + (query.inStock ? 1 : 0)
  );
}

/**
 * Whether this is the listing itself, rather than a view of it.
 *
 * One listing is indexed; every narrowing, reordering and page of it is
 * `noindex, follow` and canonicalises back here. That is the rule Phase 14 set
 * for the gallery and this follows it rather than inventing a second one.
 *
 * Including **the page number** in that is a deliberate, arguable choice. The
 * alternative — a self-canonical on page 2 — is what Google now recommends in
 * general, and it is the better answer for a catalogue of two thousand
 * products. This one holds eight. Page 2 is a view of a short list, its
 * products are all linked from page 1 within one hop, and one indexable
 * catalogue is worth more than four near-identical ones. Revisit it the day the
 * catalogue outgrows a couple of pages; until then, `follow` is what keeps the
 * crawler walking through to the product pages.
 */
export function isDefaultCatalogueView(query: CatalogueQuery): boolean {
  return (
    !hasActiveCatalogueFilters(query) &&
    query.sort === DEFAULT_CATALOGUE_SORT &&
    query.page === 1
  );
}

/* ---------------------------------------------------------------------------
 * Writing the next one
 * ------------------------------------------------------------------------ */

/**
 * The URL for a query, against a base path.
 *
 * The base is `/shop` or `/shop/c/<slug>` — the category lives in the path, not
 * the query string, so that a category listing is a page a crawler can index
 * and a person can recognise.
 *
 * Defaults are **left out** rather than written down. `?sort=NEWEST&page=1` and
 * `/shop` are the same page, and a link that produces the first is a second URL
 * for the same content and a canonical tag to explain it away. No locale prefix
 * either: these go to `Link`, which adds the language (rule 9A).
 */
export function catalogueHref(base: string, query: CatalogueQuery): string {
  const search = new URLSearchParams();

  if (query.q) search.set('q', query.q);
  if (query.sort !== DEFAULT_CATALOGUE_SORT) search.set('sort', query.sort);
  if (query.customisable) search.set('customisable', '1');
  if (query.inStock) search.set('inStock', '1');
  if (query.page > 1) search.set('page', String(query.page));

  const rendered = search.toString();
  return rendered === '' ? base : `${base}?${rendered}`;
}

/**
 * The same view, with one thing changed.
 *
 * **Changing anything but the page returns to page 1**, because page 4 of an
 * unfiltered catalogue is rarely page 4 of a filtered one, and landing on an
 * empty page after ticking a box reads as a broken filter rather than as a
 * narrow result.
 */
export function withCatalogueChange(
  query: CatalogueQuery,
  change: Partial<CatalogueQuery>,
): CatalogueQuery {
  const next = { ...query, ...change };

  return 'page' in change ? next : { ...next, page: 1 };
}

/** The href that turns one boolean filter on or off. */
export function toggleCatalogueFilter(
  base: string,
  query: CatalogueQuery,
  filter: 'customisable' | 'inStock',
): string {
  return catalogueHref(base, withCatalogueChange(query, { [filter]: !query[filter] }));
}

/** The href that clears every filter, keeping the chosen order. */
export function clearedCatalogueHref(base: string, query: CatalogueQuery): string {
  return catalogueHref(base, {
    ...NO_CATALOGUE_QUERY,
    sort: query.sort,
  });
}

/* ---------------------------------------------------------------------------
 * Pages
 * ------------------------------------------------------------------------ */

/** How many pages a result set fills. Always at least one, even when empty. */
export function cataloguePageCount(total: number, perPage = CATALOGUE_PER_PAGE): number {
  if (total <= 0) return 1;

  return Math.ceil(total / perPage);
}

/**
 * The page numbers to draw, given where the visitor is.
 *
 * Every page when there are few, and a window around the current one when there
 * are many, with `null` standing for the gap. A row of forty page links is a
 * row nobody reads and forty links a crawler follows.
 */
export function cataloguePageWindow(
  page: number,
  pageCount: number,
  span = 2,
): readonly (number | null)[] {
  if (pageCount <= 1) return [1];
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const window = new Set<number>([1, pageCount]);
  for (let candidate = page - span; candidate <= page + span; candidate += 1) {
    if (candidate >= 1 && candidate <= pageCount) window.add(candidate);
  }

  const pages = [...window].sort((a, b) => a - b);
  const withGaps: (number | null)[] = [];

  pages.forEach((value, index) => {
    const previous = pages[index - 1];
    if (previous !== undefined && value - previous > 1) withGaps.push(null);
    withGaps.push(value);
  });

  return withGaps;
}

/**
 * Split a search term into the words that all have to match.
 *
 * "tote toile" should find "Tote bag en toile écrue", which one `LIKE
 * '%tote toile%'` cannot do. Each word becomes its own condition and they are
 * combined with AND, so adding a word always narrows — which is what typing
 * more of what you want is supposed to do.
 *
 * Capped, because each word is a separate `ILIKE` against three columns and a
 * visitor who pastes a paragraph should not get a forty-way join.
 */
export function searchTerms(term: string, max = 6): readonly string[] {
  return term
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .slice(0, max);
}
