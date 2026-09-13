import type { Dictionary } from '@/i18n';
import type { CatalogueBadge } from '@/server/repositories/catalogue-repository';

/**
 * The words for a catalogue badge, and the treatment it takes.
 *
 * The repository decides *which* marker a product earns; this decides what it
 * says and how it looks. Splitting them is what lets the same product render
 * "Nouveau" and "New" from one row.
 */
export function badgeFor(
  badge: CatalogueBadge,
  t: Dictionary,
): { label: string; variant: 'solid' | 'accentSubtle' } {
  switch (badge) {
    case 'NEW':
      return { label: t.product.badgeNew, variant: 'solid' };
    case 'BEST_SELLER':
      return { label: t.product.badgeBestSeller, variant: 'solid' };
    case 'CUSTOMISABLE':
      // Last in the repository's priority order, and the quietest treatment:
      // it is true of nearly every product (section 8).
      return { label: t.product.badgeCustomisable, variant: 'accentSubtle' };
  }
}
