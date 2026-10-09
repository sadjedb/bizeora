import { ArrowLeft, ArrowRight, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Container, Grid, Section, Stack } from '@/components/layout/layout';
import { EmptyState } from '@/components/ui/feedback';
import { FilterBar, FilterLink } from '@/components/ui/page-header';
import { Text } from '@/components/ui/typography';
import { Input, NativeSelect } from '@/components/ui/input';
import { Link } from '@/components/ui/link';
import { ProductCard } from '@/components/commerce/product-card';
import { cn } from '@/components/ui/cn';
import { dictionaryFor } from '@/i18n';
import { localePath, type Locale } from '@/i18n/locales';
import {
  CATALOGUE_SORTS,
  DEFAULT_CATALOGUE_SORT,
  activeCatalogueFilterCount,
  catalogueHref,
  cataloguePageWindow,
  clearedCatalogueHref,
  hasActiveCatalogueFilters,
  withCatalogueChange,
  type CatalogueQuery,
  type CatalogueSort,
} from '@/domain/catalogue/browse';
import type {
  CatalogueCategory,
  CatalogueListing,
} from '@/server/repositories/catalogue-repository';

import { toCardProduct } from '../product-card-props';

/**
 * The catalogue, however it is being looked at.
 *
 * One component behind two routes: `/shop` and `/shop/c/[category]`. They
 * differ in the heading above the grid and in which products the query
 * returned — everything from the toolbar down is identical, and duplicating it
 * would mean two places to fix the day a filter changes.
 *
 * ## Filters are URLs, and the form works with JavaScript off
 *
 * Categories are links, because a category is a page: `/shop/c/tote-bags` is
 * somewhere a customer can be sent and a crawler can index. Everything else —
 * the search box, the order, the two switches — lives in one `GET` form with
 * one submit button, which is the plainest thing that works: no client state,
 * no debounce, no hydration, and the result is an address that survives being
 * pasted into a message.
 *
 * The cost is one button press to apply a filter rather than an instant
 * toggle. `UX.md` section 12 asks for filters that work on a phone with a poor
 * connection; a form that needs no JavaScript at all is the strongest version
 * of that, and the pieces are all native controls a browser already knows how
 * to render on a small screen.
 */

type CatalogueViewProps = {
  locale: Locale;
  /** `/shop` or `/shop/c/<slug>` — no language prefix; `Link` adds it. */
  base: string;
  query: CatalogueQuery;
  listing: CatalogueListing;
  categories: readonly CatalogueCategory[];
  /** The category slug in the path, when this is a category listing. */
  activeCategory: string | null;
  /** The masthead. Differs per route, so the routes own it. */
  header: React.ReactNode;
};

export function CatalogueView({
  locale,
  base,
  query,
  listing,
  categories,
  activeCategory,
  header,
}: CatalogueViewProps) {
  const { t } = dictionaryFor(locale);
  const filtered = hasActiveCatalogueFilters(query);
  const filterCount = activeCatalogueFilterCount(query);

  const sortLabels: Record<CatalogueSort, string> = {
    NEWEST: t.shop.sortNewest,
    PRICE_ASC: t.shop.sortPriceAsc,
    PRICE_DESC: t.shop.sortPriceDesc,
    NAME: t.shop.sortName,
  };

  return (
    <Section as="section" spacing="compact" className="pb-20 lg:pb-32">
      <Container>
        <Stack gap={10}>
          {header}

          <Stack gap={6}>
            {/*
             * Categories, as a row of links.
             *
             * "Tout" leads back to `/shop` and carries no filters with it —
             * changing the set you are looking at is a different act from
             * narrowing it, and quietly keeping a search term while the
             * category changes is how a visitor ends up on an empty page
             * wondering what happened.
             */}
            {categories.length > 0 && (
              <FilterBar label={t.shop.categoriesLabel}>
                <FilterLink href="/shop" current={activeCategory === null} shape="pill">
                  {t.shop.allCategories}
                </FilterLink>

                {categories.map((category) => (
                  <FilterLink
                    key={category.slug}
                    href={`/shop/c/${category.slug}`}
                    current={activeCategory === category.slug}
                    count={category.count}
                    shape="pill"
                  >
                    {category.name}
                  </FilterLink>
                ))}
              </FilterBar>
            )}

            {/*
             * `localePath` rather than a bare path: a form action is not a
             * `Link`, so nothing adds the language for it (rule 9A). Submitting
             * drops `page`, which is the behaviour we want — a new search
             * starts at the beginning.
             */}
            <form
              action={localePath(locale, base)}
              method="get"
              role="search"
              aria-label={t.shop.filtersLabel}
              className="border-border flex flex-col gap-4 border-y py-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="flex flex-1 items-center gap-2">
                <label htmlFor="catalogue-search" className="sr-only">
                  {t.shop.searchLabel}
                </label>
                <Input
                  id="catalogue-search"
                  name="q"
                  type="search"
                  defaultValue={query.q ?? ''}
                  placeholder={t.shop.searchPlaceholder}
                  maxLength={80}
                  className="rounded-full px-5 lg:max-w-xs"
                />

                <Button type="submit" variant="secondary" shape="pill" size="md">
                  <Search className="size-4" aria-hidden="true" />
                  <span className="sr-only lg:not-sr-only">{t.shop.searchAction}</span>
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <CheckFilter
                  name="customisable"
                  checked={query.customisable}
                  label={t.shop.filterCustomisable}
                />
                <CheckFilter
                  name="inStock"
                  checked={query.inStock}
                  label={t.shop.filterInStock}
                />

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="catalogue-sort"
                    className="text-body-sm text-fg-subtle whitespace-nowrap"
                  >
                    {t.shop.sortLabel}
                  </label>
                  {/*
                   * The default order submits an empty value on purpose, so
                   * choosing "newest" produces `/shop` rather than a second URL
                   * for the same page.
                   */}
                  <NativeSelect
                    id="catalogue-sort"
                    name="sort"
                    defaultValue={query.sort === DEFAULT_CATALOGUE_SORT ? '' : query.sort}
                    className="w-auto rounded-full"
                  >
                    {CATALOGUE_SORTS.map((sort) => (
                      <option
                        key={sort}
                        value={sort === DEFAULT_CATALOGUE_SORT ? '' : sort}
                      >
                        {sortLabels[sort]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
            </form>

            {/*
             * The count, and the way out.
             *
             * `UX.md` section 4 asks for a visible filter count on the
             * catalogue. It is only worth showing when something is filtered —
             * "0 filtres actifs" is noise — and it sits beside the link that
             * undoes them, because the two are one thought.
             */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <Text variant="body-sm" tone="subtle" numeric>
                {filtered
                  ? t.shop.countOf(listing.total, listing.totalUnfiltered)
                  : t.shop.count(listing.total)}
              </Text>

              {filterCount > 0 && (
                <Text variant="body-sm" tone="subtle" as="span">
                  {t.shop.activeFilters(filterCount)}
                  {' · '}
                  <Link href={clearedCatalogueHref(base, query)} variant="inline">
                    {t.shop.clearFilters}
                  </Link>
                </Text>
              )}
            </div>
          </Stack>

          {listing.items.length === 0 ? (
            filtered ? (
              /*
               * A narrow result and an empty shop are different problems and
               * get different words. This one is recoverable, and says so with
               * the link that recovers it (`UX.md` section 13).
               */
              <EmptyState
                title={t.shop.noMatchTitle}
                description={t.shop.noMatchBody}
                action={
                  <Button asChild variant="secondary" shape="pill">
                    <Link href={clearedCatalogueHref(base, query)} variant="plain">
                      {t.shop.noMatchAction}
                    </Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState title={t.shop.emptyTitle} description={t.shop.emptyBody} />
            )
          ) : (
            <Stack gap={10}>
              <Grid preset="products" gap={6}>
                {listing.items.map((product, index) => (
                  <ProductCard
                    key={product.slug}
                    // The first row is above the fold at every breakpoint.
                    priority={index < 4}
                    product={toCardProduct(product, t)}
                  />
                ))}
              </Grid>

              <CataloguePagination
                locale={locale}
                base={base}
                query={query}
                listing={listing}
              />
            </Stack>
          )}
        </Stack>
      </Container>
    </Section>
  );
}

/**
 * One switch in the filter form.
 *
 * A plain checkbox rather than the design system's `CheckboxField`, which is a
 * Radix control with its own state. Inside a `GET` form the browser's own
 * checkbox is the whole feature: it submits its name when it is ticked and
 * nothing when it is not, which is exactly what the parser reads.
 */
function CheckFilter({
  name,
  checked,
  label,
}: {
  name: string;
  checked: boolean;
  label: string;
}) {
  return (
    <label className="text-body-sm text-fg-muted flex min-h-11 cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={checked}
        className="accent-fg size-4 shrink-0"
      />
      {label}
    </label>
  );
}

/**
 * Previous, next, and the numbers in between.
 *
 * Real links, so a page of the catalogue is an address: the back button works,
 * a crawler can walk through to the products on page three, and nothing
 * depends on JavaScript. Absent entirely when there is one page — pagination
 * that says "1 / 1" is furniture.
 */
function CataloguePagination({
  locale,
  base,
  query,
  listing,
}: {
  locale: Locale;
  base: string;
  query: CatalogueQuery;
  listing: CatalogueListing;
}) {
  const { t } = dictionaryFor(locale);
  if (listing.pageCount <= 1) return null;

  const href = (page: number) =>
    catalogueHref(base, withCatalogueChange(query, { page }));

  const previous = listing.page > 1 ? href(listing.page - 1) : null;
  const next = listing.page < listing.pageCount ? href(listing.page + 1) : null;

  return (
    <nav
      aria-label={t.shop.pagination}
      className="border-border flex items-center justify-between gap-4 border-t pt-8"
    >
      <PageStep href={previous} label={t.shop.previousPage} direction="previous" />

      <ul className="flex list-none items-center gap-1 p-0">
        {cataloguePageWindow(listing.page, listing.pageCount).map((page, index) =>
          page === null ? (
            <li
              key={`gap-${index}`}
              aria-hidden="true"
              className="text-fg-subtle px-1 select-none"
            >
              &hellip;
            </li>
          ) : (
            <li key={page}>
              <Link
                href={href(page)}
                variant="plain"
                aria-label={t.shop.goToPage(page)}
                aria-current={page === listing.page ? 'page' : undefined}
                className={cn(
                  'text-body-sm flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 tabular-nums',
                  'duration-fast transition-colors ease-out motion-reduce:transition-none',
                  page === listing.page
                    ? 'bg-fg text-fg-inverted font-medium'
                    : 'text-fg-muted hover:bg-bg-sunken hover:text-fg',
                )}
              >
                {page}
              </Link>
            </li>
          ),
        )}
      </ul>

      <PageStep href={next} label={t.shop.nextPage} direction="next" />
    </nav>
  );
}

/**
 * The step at either end.
 *
 * At the first or last page there is nothing to link to, and the answer is a
 * disabled-looking span rather than a link to the page you are on: a link that
 * goes nowhere is a promise the interface does not keep, and `aria-disabled` on
 * an anchor still leaves it in the tab order.
 */
function PageStep({
  href,
  label,
  direction,
}: {
  href: string | null;
  label: string;
  direction: 'previous' | 'next';
}) {
  const Icon = direction === 'previous' ? ArrowLeft : ArrowRight;
  const icon = <Icon className="size-4" aria-hidden="true" />;

  if (href === null) {
    return (
      <span
        className="text-fg-subtle text-body-sm flex min-h-11 items-center gap-2 px-2 opacity-50"
        aria-hidden="true"
      >
        {direction === 'previous' && icon}
        <span className="hidden sm:inline">{label}</span>
        {direction === 'next' && icon}
      </span>
    );
  }

  return (
    <Link
      href={href}
      variant="plain"
      className="text-fg-muted hover:text-fg text-body-sm flex min-h-11 items-center gap-2 px-2"
    >
      {direction === 'previous' && icon}
      <span className="hidden sm:inline">{label}</span>
      {direction === 'next' && icon}
    </Link>
  );
}
