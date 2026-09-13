// @vitest-environment jsdom

/**
 * Storefront presentation, against the catalogue DTOs.
 *
 * These build DTOs by hand rather than mocking Prisma. That is the point of the
 * boundary: if a component ever needed a database to render, the mock would be
 * the warning. Query behaviour is tested against a real database in
 * `tests/integration/catalogue.test.ts`; this file tests what the UI does with
 * the result.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * `PurchasePanel` calls a server action to add to the cart, and a `'use server'`
 * module is a client reference in the browser bundle — but a plain import in a
 * jsdom test, which would drag the database client in behind it. Stubbing the
 * action keeps this file testing what it says it tests: presentation, with no
 * infrastructure anywhere near it.
 */
vi.mock('../../src/app/(site)/[locale]/(storefront)/cart/actions', () => ({
  addToCartAction: vi.fn(async () => ({ ok: true })),
}));

import { ProductCard } from '@/components/commerce/product-card';
import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import type { CatalogueProductSummary } from '@/server/repositories/catalogue-repository';

import {
  footerColumns,
  footerContact,
  storefrontNav,
} from '../../src/app/(site)/[locale]/navigation';
import { fr } from '../../src/i18n/dictionaries/fr';
import { toCardProduct } from '../../src/app/(site)/[locale]/(storefront)/product-card-props';
import { addToCartAction } from '../../src/app/(site)/[locale]/(storefront)/cart/actions';
import {
  PurchasePanel,
  type PanelOption,
  type PanelVariant,
} from '../../src/app/(site)/[locale]/(storefront)/shop/[slug]/purchase-panel';

const SUMMARY: CatalogueProductSummary = {
  slug: 't-shirt-brode-classique',
  name: 'T-shirt brodé classique',
  category: 'T-shirts',
  price: 4800,
  compareAtPrice: 6000,
  currency: 'DZD',
  image: {
    src: null,
    alt: 'T-shirt brodé noir, vue de face',
    width: 1200,
    height: 1500,
    blurDataUrl: null,
  },
  available: true,
  isCustomizable: true,
  // A kind, not a label: the repository stopped deciding the words when the
  // storefront became bilingual.
  badge: 'NEW',
};

const OPTIONS: PanelOption[] = [
  {
    name: 'Taille',
    values: [
      { value: 'S', hexColor: null },
      { value: 'M', hexColor: null },
    ],
  },
  {
    name: 'Couleur',
    values: [
      { value: 'Noir', hexColor: '#12100e' },
      { value: 'Écru', hexColor: '#f6f2ec' },
    ],
  },
];

const VARIANTS: PanelVariant[] = [
  {
    sku: 'TS-NOI-S',
    options: { Taille: 'S', Couleur: 'Noir' },
    price: 4800,
    compareAtPrice: 6000,
    available: true,
  },
  {
    sku: 'TS-NOI-M',
    options: { Taille: 'M', Couleur: 'Noir' },
    price: 4800,
    compareAtPrice: 6000,
    available: true,
  },
  {
    // Deliberately dearer, so a test can prove the panel shows the variant's
    // own price rather than the product's base price.
    sku: 'TS-ECR-M',
    options: { Taille: 'M', Couleur: 'Écru' },
    price: 5200,
    compareAtPrice: null,
    available: true,
  },
  {
    sku: 'TS-ECR-S',
    options: { Taille: 'S', Couleur: 'Écru' },
    price: 4800,
    compareAtPrice: null,
    available: false,
  },
];

describe('toCardProduct', () => {
  it('maps a catalogue summary onto card props without transforming values', () => {
    const card = toCardProduct(SUMMARY, fr);

    expect(card.href).toBe('/shop/t-shirt-brode-classique');
    expect(card.name).toBe(SUMMARY.name);
    expect(card.eyebrow).toBe('T-shirts');
    expect(card.price).toBe(4800);
    expect(card.compareAtPrice).toBe(6000);
    expect(card.available).toBe(true);
    // The dictionary supplies the words at the point of rendering.
    expect(card.badge).toEqual({ label: fr.product.badgeNew, variant: 'solid' });
  });

  it('falls back to the product name when an image carries no alt', () => {
    const card = toCardProduct({ ...SUMMARY, image: null }, fr);

    expect(card.imageSrc).toBeNull();
    expect(card.imageAlt).toBe(SUMMARY.name);
  });

  it('omits a compare-at price the repository resolved to null', () => {
    // The domain drops a compare-at that is not strictly higher, so the card
    // must not receive one to render.
    const card = toCardProduct({ ...SUMMARY, compareAtPrice: null }, fr);
    expect(card.compareAtPrice).toBeUndefined();
  });

  it('renders into a card that links to the product', () => {
    render(<ProductCard product={toCardProduct(SUMMARY, fr)} />);

    expect(screen.getByRole('link', { name: SUMMARY.name })).toHaveAttribute(
      'href',
      // `Link` adds the language prefix; the setup mounts a French path.
      '/fr/shop/t-shirt-brode-classique',
    );
    expect(screen.getByText(/4\s*800/)).toBeInTheDocument();
  });
});

describe('PurchasePanel', () => {
  function renderPanel(overrides: Partial<Parameters<typeof PurchasePanel>[0]> = {}) {
    return render(
      <PurchasePanel
        productSlug="t-shirt-brode-classique"
        options={OPTIONS}
        variants={VARIANTS}
        fallbackPrice={4800}
        fallbackCompareAtPrice={6000}
        currency="DZD"
        customisable={false}
        {...overrides}
      />,
    );
  }

  it('opens on an available variant rather than a sold-out one', () => {
    renderPanel();

    // TS-ECR-S is unavailable and must not be the opening selection.
    expect(screen.getByRole('button', { name: 'Ajouter au panier' })).toBeInTheDocument();
    expect(screen.getByText('TS-NOI-S')).toBeInTheDocument();
  });

  it('shows the selected variant’s own price, not the product base price', async () => {
    renderPanel();

    expect(screen.getByText(/4\s*800/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /Écru/ }));
    await userEvent.click(screen.getByRole('radio', { name: 'M' }));

    // 5 200 comes from the variant DTO. The component computed nothing.
    expect(screen.getByText(/5\s*200/)).toBeInTheDocument();
    expect(screen.getByText('TS-ECR-M')).toBeInTheDocument();
  });

  it('marks a value that no available variant carries', () => {
    renderPanel({
      // Only "M" is stocked anywhere, so "S" is sold out outright.
      variants: VARIANTS.map((variant) =>
        variant.options.Taille === 'S' ? { ...variant, available: false } : variant,
      ),
    });

    expect(screen.getByRole('radio', { name: 'S' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'M' })).not.toHaveAttribute('aria-disabled');
  });

  it('never traps the user by narrowing one axis against another', async () => {
    renderPanel();

    // Opens on S / Noir. Écru is only available in M — filtering each axis by
    // the other would disable Écru here and leave no way to reach the
    // available Écru / M piece at all.
    const ecru = screen.getByRole('radio', { name: /Écru/ });
    expect(ecru).not.toHaveAttribute('aria-disabled');

    await userEvent.click(ecru);
    expect(ecru).toBeChecked();
  });

  it('reports a combination that does not exist, at the action', async () => {
    renderPanel();

    await userEvent.click(screen.getByRole('radio', { name: /Écru/ }));
    // Selection is now Écru / S, which is the sold-out variant.
    expect(screen.getByRole('button', { name: 'Indisponible' })).toBeInTheDocument();
    expect(screen.getByText(/combinaison n’est pas disponible/i)).toBeInTheDocument();
  });

  it('keeps a sold-out value focusable, so it is discoverable', async () => {
    renderPanel({
      variants: VARIANTS.map((variant) =>
        variant.options.Taille === 'S' ? { ...variant, available: false } : variant,
      ),
    });

    const soldOut = screen.getByRole('radio', { name: 'S' });
    soldOut.focus();
    expect(soldOut).toHaveFocus();

    // Reachable by keyboard, but choosing it does nothing.
    await userEvent.click(soldOut);
    expect(soldOut).not.toBeChecked();
  });

  it('adds to the cart by identifier, and never by price', async () => {
    renderPanel();

    const add = screen.getByRole('button', { name: 'Ajouter au panier' });
    expect(add).toBeEnabled();

    await userEvent.click(add);

    // The payload names the product, the variant and how many. There is no
    // price in it, and no field where one could be put — the server re-reads
    // every one of these (BUSINESS-RULES.md 5.2, SECURITY.md section 5).
    expect(addToCartAction).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(addToCartAction).mock.calls[0]![0];

    expect(payload).toEqual({
      productSlug: 't-shirt-brode-classique',
      variantSku: expect.any(String),
      quantity: 1,
    });

    for (const forbidden of ['price', 'unitPrice', 'total', 'subtotal', 'discount']) {
      expect(Object.keys(payload), `payload carries ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it('confirms the addition in a live region rather than only visually', async () => {
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Ajouter au panier' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Ajouté à votre panier.');
    expect(screen.getByRole('link', { name: 'Voir le panier' })).toHaveAttribute(
      'href',
      '/fr/cart',
    );
  });

  it('reports an unavailable selection and locks the quantity', () => {
    renderPanel({
      variants: [{ ...VARIANTS[3]!, available: false }],
      options: [],
    });

    expect(screen.getByRole('button', { name: 'Indisponible' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Quantité' })).toBeDisabled();
  });

  it('falls back to the product price when a product has no variants', () => {
    renderPanel({ options: [], variants: [] });

    expect(screen.getByText(/4\s*800/)).toBeInTheDocument();
    // No variants and no tracking means the piece is still orderable.
    expect(screen.getByRole('button', { name: 'Ajouter au panier' })).toBeInTheDocument();
  });

  it('drives the quantity selector', async () => {
    renderPanel();

    const field = screen.getByRole('textbox', { name: 'Quantité' });
    expect(field).toHaveValue('1');

    await userEvent.click(screen.getByRole('button', { name: /augmenter/i }));
    expect(field).toHaveValue('2');
  });

  it('offers the custom path only for a customisable piece', () => {
    const { unmount } = renderPanel();
    expect(screen.queryByRole('link', { name: /broderie personnalisée/i })).toBeNull();
    unmount();

    renderPanel({ customisable: true });
    expect(screen.getByRole('link', { name: /broderie personnalisée/i })).toHaveAttribute(
      'href',
      '/fr/custom',
    );
  });
});

/*
 * The navigation is a function of the dictionary since the site became
 * bilingual. These build the French set once, which is what the previous
 * constants were.
 */
const STOREFRONT_NAV = storefrontNav(fr);
const FOOTER_COLUMNS = footerColumns(fr);
const FOOTER_CONTACT = footerContact(fr);

describe('storefront navigation', () => {
  it('emphasises the custom path, which is the highest-value destination', () => {
    expect(STOREFRONT_NAV.find((item) => item.href === '/custom')?.accent).toBe(true);
  });

  it('lists only routes that exist', () => {
    // Derived from the route files rather than hand-listed. A hand-written set
    // goes stale in the safe direction only until somebody adds a page, and
    // then it fails for the wrong reason — as it did when `/gallery` landed.
    // `process.cwd()` rather than `import.meta.url`: this file runs under
    // jsdom, where `import.meta.url` is an http URL and not a path.
    const root = join(process.cwd(), 'src', 'app', '(site)', '[locale]', '(storefront)');
    const built = new Set<string>();

    function walk(directory: string, route: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isFile() && /^page\.tsx?$/.test(entry.name)) {
          built.add(route === '' ? '/' : route);
          continue;
        }

        if (!entry.isDirectory()) continue;

        // A dynamic segment is not a destination a navigation item can name,
        // and a route group adds nothing to the URL.
        if (entry.name.startsWith('[')) continue;

        const segment = entry.name.startsWith('(') ? '' : `/${entry.name}`;
        walk(join(directory, entry.name), `${route}${segment}`);
      }
    }

    walk(root, '');

    expect(built.has('/shop')).toBe(true);

    for (const item of STOREFRONT_NAV) {
      expect(built.has(item.href), `nav → ${item.href}`).toBe(true);
    }
    for (const column of FOOTER_COLUMNS) {
      for (const link of column.links) {
        expect(built.has(link.href), `footer → ${link.href}`).toBe(true);
      }
    }
  });

  it('renders the header without a cart or account it does not have', () => {
    render(<Header items={STOREFRONT_NAV} currentPath="/shop" searchSlot={null} />);

    expect(screen.getByRole('link', { name: 'Boutique' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /panier/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /mon compte/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /rechercher/i })).toBeNull();
  });

  it('marks the current page in the header', () => {
    render(<Header items={STOREFRONT_NAV} currentPath="/shop" searchSlot={null} />);

    const [shopLink] = screen.getAllByRole('link', { name: 'Boutique' });
    expect(shopLink).toHaveAttribute('aria-current', 'page');
  });

  it('renders the footer columns as named navigation landmarks', () => {
    render(<Footer columns={FOOTER_COLUMNS} contact={FOOTER_CONTACT} />);

    for (const column of FOOTER_COLUMNS) {
      expect(
        screen.getByRole('navigation', { name: column.heading }),
      ).toBeInTheDocument();
    }
    expect(screen.getByText(fr.footer.deliveryNote)).toBeInTheDocument();
  });
});
