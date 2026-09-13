import { describe, expect, it } from 'vitest';

import {
  IN_STOCK,
  OUT_OF_STOCK,
  breadcrumbLd,
  itemListLd,
  organizationLd,
  productLd,
  schemaPrice,
  serialiseJsonLd,
  webSiteLd,
} from '@/domain/seo';

/**
 * Structured data, and the one way it can do harm.
 *
 * Most of this file asserts an **absence**: no `aggregateRating` on a product
 * nobody has reviewed, no `sameAs` when there are no profiles, no
 * `BreadcrumbList` with nothing in it. Telling a search engine something the
 * page does not say is the failure mode that gets a site penalised, and it is
 * always an over-eager default rather than a deliberate lie.
 */

const BASE = {
  name: 'Tote bag toile épaisse',
  description: 'Toile de coton 340 g/m².',
  url: 'https://example.test/shop/tote-bag',
  images: [] as readonly string[],
  price: 2500,
  currency: 'DZD',
  available: true,
  category: 'Accessoires',
  sku: null,
  rating: { average: null, count: 0 },
};

describe('the organisation', () => {
  it('omits a logo and profiles it does not have', () => {
    const node = organizationLd({
      name: 'Bizeora',
      legalName: 'Bizeora',
      description: 'Broderie.',
      url: 'https://example.test',
      logo: null,
      sameAs: [],
    });

    expect(node).not.toHaveProperty('logo');
    expect(node).not.toHaveProperty('sameAs');
    expect(node['@type']).toBe('Organization');
  });

  it('includes them when they exist', () => {
    const node = organizationLd({
      name: 'Bizeora',
      legalName: 'Bizeora SARL',
      description: 'Broderie.',
      url: 'https://example.test',
      logo: 'https://cdn.example.test/logo.png',
      sameAs: ['https://example.test/profile'],
    });

    expect(node.logo).toBe('https://cdn.example.test/logo.png');
    expect(node.sameAs).toEqual(['https://example.test/profile']);
  });

  it('declares the site’s language', () => {
    expect(webSiteLd({ name: 'Bizeora', url: 'https://example.test' }).inLanguage).toBe(
      'fr',
    );
  });
});

describe('breadcrumbs', () => {
  it('numbers the trail from one, in order', () => {
    const node = breadcrumbLd([
      { name: 'Accueil', url: 'https://example.test' },
      { name: 'Boutique', url: 'https://example.test/shop' },
    ]);

    expect(node).not.toBeNull();
    expect(node!.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Accueil',
        item: 'https://example.test',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Boutique',
        item: 'https://example.test/shop',
      },
    ]);
  });

  it('is nothing at all when there is no trail', () => {
    expect(breadcrumbLd([])).toBeNull();
  });
});

describe('a product', () => {
  it('states the price the page states, with a dot and no grouping', () => {
    // The dinar is quoted in whole units and the page renders "2 500 DA", so
    // the offer says 2500 — not 25.00, and not "2 500".
    expect(schemaPrice(2500)).toBe('2500');
    expect(productLd(BASE).offers).toMatchObject({
      price: '2500',
      priceCurrency: 'DZD',
    });
  });

  it('follows the display convention when a currency has subunits', () => {
    expect(schemaPrice(2500, 2)).toBe('25.00');
    expect(
      (productLd({ ...BASE, priceFractionDigits: 2 }).offers as { price: string }).price,
    ).toBe('25.00');
  });

  it('reports availability from the same boolean the page renders', () => {
    expect((productLd(BASE).offers as { availability: string }).availability).toBe(
      IN_STOCK,
    );

    expect(
      (productLd({ ...BASE, available: false }).offers as { availability: string })
        .availability,
    ).toBe(OUT_OF_STOCK);
  });

  it('omits aggregateRating entirely when nothing has been approved', () => {
    expect(productLd(BASE)).not.toHaveProperty('aggregateRating');

    // A count with no average, and an average with no count, are both nothing.
    expect(
      productLd({ ...BASE, rating: { average: null, count: 3 } }),
    ).not.toHaveProperty('aggregateRating');
    expect(productLd({ ...BASE, rating: { average: 450, count: 0 } })).not.toHaveProperty(
      'aggregateRating',
    );
  });

  it('emits the real aggregate when there is one', () => {
    const node = productLd({ ...BASE, rating: { average: 467, count: 3 } });

    expect(node.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: '4.67',
      reviewCount: 3,
      bestRating: 5,
      worstRating: 1,
    });
  });

  it('omits an image list, a category and a SKU it does not have', () => {
    const node = productLd({ ...BASE, category: null, sku: null, images: [] });

    expect(node).not.toHaveProperty('image');
    expect(node).not.toHaveProperty('category');
    expect(node).not.toHaveProperty('sku');
  });

  it('carries them when they exist', () => {
    const node = productLd({
      ...BASE,
      images: ['https://cdn.example.test/a.jpg'],
      sku: 'TOTE-ECR',
    });

    expect(node.image).toEqual(['https://cdn.example.test/a.jpg']);
    expect(node.sku).toBe('TOTE-ECR');
  });
});

describe('a listing', () => {
  it('numbers its items and counts them', () => {
    const node = itemListLd({
      name: 'Boutique',
      items: [
        { name: 'A', url: 'https://example.test/shop/a' },
        { name: 'B', url: 'https://example.test/shop/b' },
      ],
    });

    expect(node!.numberOfItems).toBe(2);
    expect(
      (node!.itemListElement as { position: number }[]).map((i) => i.position),
    ).toEqual([1, 2]);
  });

  it('is nothing at all when the listing is empty', () => {
    expect(itemListLd({ name: 'Boutique', items: [] })).toBeNull();
  });
});

describe('serialisation', () => {
  it('cannot close the script element it sits in', () => {
    const serialised = serialiseJsonLd({
      '@type': 'Product',
      name: 'Sac </script><script>alert(1)</script>',
    });

    expect(serialised).not.toContain('</script>');
    expect(serialised).toContain('\\u003c');

    // Still valid JSON, and still the same string once parsed.
    expect((JSON.parse(serialised) as { name: string }).name).toBe(
      'Sac </script><script>alert(1)</script>',
    );
  });

  it('serialises a list of nodes as an array', () => {
    const parsed: unknown = JSON.parse(
      serialiseJsonLd([{ '@type': 'A' }, { '@type': 'B' }]),
    );

    expect(Array.isArray(parsed)).toBe(true);
  });
});
