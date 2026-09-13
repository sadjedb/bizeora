'use client';

import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { ProductStatus } from '@/domain/catalogue';

/**
 * Catalogue search.
 *
 * A `GET` form to the same page rather than a controlled input with a debounce:
 * the result is a URL, so a search can be bookmarked, shared with the person
 * doing the count, and reloaded without retyping. The status filter travels
 * with it as a hidden field so searching does not silently drop the filter the
 * operator is standing in.
 *
 * It searches names, slugs and SKUs, because what the workshop has in hand is
 * usually a label rather than a product name.
 */
export function ProductSearch({
  defaultValue,
  status,
  placeholder = 'Nom, adresse ou SKU',
  action = '/admin/products',
}: {
  defaultValue: string;
  status?: ProductStatus | null;
  placeholder?: string;
  action?: string;
}) {
  return (
    <form action={action} className="flex items-center gap-2" role="search">
      {status && <input type="hidden" name="status" value={status} />}

      <label htmlFor="product-search" className="sr-only">
        Rechercher un produit
      </label>
      <Input
        id="product-search"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="md:w-64"
      />

      <Button type="submit" variant="secondary" size="md">
        <Search className="size-4" aria-hidden="true" />
        <span className="sr-only md:not-sr-only">Rechercher</span>
      </Button>
    </form>
  );
}
