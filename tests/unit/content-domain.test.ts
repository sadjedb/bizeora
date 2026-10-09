import { describe, expect, it } from 'vitest';

import {
  HOMEPAGE_SECTION_TYPES,
  MAX_MARQUEE_WORDS,
  MAX_SECTION_ITEMS,
  activeBanners,
  collectDataNeeds,
  commonConfig,
  dataNeeds,
  headingSegments,
  heroConfig,
  localiseSection,
  marqueeConfig,
  isHomepageSectionType,
  listConfig,
  orderedSections,
  plainHeading,
  pointsConfig,
  whyUsConfig,
  type Banner,
  type HomepageSection,
} from '@/domain/content';
import {
  GALLERY_CONSENT_REFUSAL,
  galleryHref,
  hasActiveGalleryFilters,
  mayPublishGalleryItem,
  parseGalleryFilters,
  toggleGalleryFilter,
} from '@/domain/gallery';

/**
 * The homepage as data, and the one gallery rule that must never bend.
 *
 * The `config` tests are all variations on one question: what happens when the
 * JSON is wrong? The answer must always be "a band renders with less in it",
 * never "the front page throws", because `config` is a column a person edits.
 */

function section(overrides: Partial<HomepageSection> = {}): HomepageSection {
  return {
    id: 'a',
    type: 'HERO',
    position: 1,
    isEnabled: true,
    title: null,
    subtitle: null,
    body: null,
    ctaLabel: null,
    ctaHref: null,
    imageKey: null,
    config: null,
    ...overrides,
  };
}

describe('the section types', () => {
  it('lists twelve, and recognises exactly those', () => {
    expect(HOMEPAGE_SECTION_TYPES).toHaveLength(12);

    for (const type of HOMEPAGE_SECTION_TYPES) {
      expect(isHomepageSectionType(type)).toBe(true);
    }

    expect(isHomepageSectionType('NEWSLETTER')).toBe(false);
    expect(isHomepageSectionType('')).toBe(false);
  });
});

describe('ordering (the "reorderable" half of Phase 13)', () => {
  it('sorts by position and drops what is switched off', () => {
    const ordered = orderedSections([
      section({ id: 'c', position: 3, type: 'FINAL_CTA' }),
      section({ id: 'a', position: 1, type: 'HERO' }),
      section({ id: 'b', position: 2, type: 'GALLERY', isEnabled: false }),
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual(['a', 'c']);
  });

  it('breaks a tie on position deterministically', () => {
    const first = orderedSections([
      section({ id: 'b', position: 1 }),
      section({ id: 'a', position: 1 }),
    ]);

    const second = orderedSections([
      section({ id: 'a', position: 1 }),
      section({ id: 'b', position: 1 }),
    ]);

    expect(first.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(second.map((entry) => entry.id)).toEqual(first.map((entry) => entry.id));
  });
});

describe('reading a malformed config', () => {
  it('survives null, a string, a number and an array', () => {
    for (const config of [null, undefined, 'nonsense', 42, [], [1, 2]]) {
      expect(commonConfig(config)).toEqual({ eyebrow: null });
      expect(pointsConfig(config).points).toEqual([]);
      expect(listConfig(config, 4).limit).toBe(4);
      expect(heroConfig(config).note).toBeNull();
      expect(whyUsConfig(config).showDelivery).toBe(false);
    }
  });

  it('treats a blank string as absent', () => {
    expect(commonConfig({ eyebrow: '   ' }).eyebrow).toBeNull();
    expect(commonConfig({ eyebrow: ' La boutique ' }).eyebrow).toBe('La boutique');
  });

  it('falls back on a limit that is not a sane whole number', () => {
    expect(listConfig({ limit: 0 }, 4).limit).toBe(4);
    expect(listConfig({ limit: -3 }, 4).limit).toBe(4);
    expect(listConfig({ limit: 2.5 }, 4).limit).toBe(4);
    expect(listConfig({ limit: '6' }, 4).limit).toBe(4);
    expect(listConfig({ limit: 6 }, 4).limit).toBe(6);
  });

  it('caps a limit so a content edit cannot scan the catalogue', () => {
    expect(listConfig({ limit: 100_000 }, 4).limit).toBe(4);
    expect(listConfig({ limit: MAX_SECTION_ITEMS }, 4).limit).toBe(MAX_SECTION_ITEMS);
  });

  it('keeps the well-formed points and drops the rest', () => {
    const parsed = pointsConfig({
      points: [
        { title: 'Brodé', body: 'Pas imprimé.', icon: 'shirt' },
        { body: 'A point with no title' },
        'not an object',
        { title: '  Spaced  ' },
      ],
    });

    expect(parsed.points).toEqual([
      { title: 'Brodé', body: 'Pas imprimé.', icon: 'shirt' },
      { title: 'Spaced', body: '', icon: null },
    ]);
  });

  it('caps how many points one band may declare', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ title: `n${index}` }));

    expect(pointsConfig({ points: many }).points).toHaveLength(MAX_SECTION_ITEMS);
  });

  it('reads the hero’s second call to action only when both halves are there', () => {
    const config = heroConfig({
      secondaryCtaLabel: 'Voir la boutique',
      secondaryCtaHref: '/shop',
      note: 'Devis sous 6 heures',
    });

    expect(config.secondaryCtaLabel).toBe('Voir la boutique');
    expect(config.secondaryCtaHref).toBe('/shop');
    expect(heroConfig({ secondaryCtaLabel: 'Seul' }).secondaryCtaHref).toBeNull();
  });

  it('treats showDelivery as true only when it is the boolean', () => {
    expect(whyUsConfig({ showDelivery: true }).showDelivery).toBe(true);
    expect(whyUsConfig({ showDelivery: 'true' }).showDelivery).toBe(false);
    expect(whyUsConfig({ showDelivery: 1 }).showDelivery).toBe(false);
  });
});

describe('what a band needs loaded', () => {
  it('maps each type to its query, and asks for nothing for static bands', () => {
    expect(dataNeeds(section({ type: 'FEATURED_PRODUCTS' }))).toEqual(['products']);
    expect(dataNeeds(section({ type: 'CATEGORY_GRID' }))).toEqual(['categories']);
    expect(dataNeeds(section({ type: 'GALLERY' }))).toEqual(['gallery']);
    expect(dataNeeds(section({ type: 'REVIEWS' }))).toEqual(['reviews']);
    expect(dataNeeds(section({ type: 'SOCIAL' }))).toEqual(['social']);
    expect(dataNeeds(section({ type: 'BANNER' }))).toEqual(['banners']);

    expect(dataNeeds(section({ type: 'HERO' }))).toEqual([]);
    expect(dataNeeds(section({ type: 'HOW_IT_WORKS' }))).toEqual([]);
    expect(dataNeeds(section({ type: 'CUSTOM_CTA' }))).toEqual([]);
    expect(dataNeeds(section({ type: 'FINAL_CTA' }))).toEqual([]);
  });

  it('asks for the delivery figures only when the trust band wants them', () => {
    expect(
      dataNeeds(section({ type: 'WHY_US', config: { showDelivery: true } })),
    ).toEqual(['delivery']);

    expect(dataNeeds(section({ type: 'WHY_US', config: {} }))).toEqual([]);
  });

  it('collects the union, so a switched-off band costs no query', () => {
    const needs = collectDataNeeds(
      orderedSections([
        section({ id: 'a', position: 1, type: 'FEATURED_PRODUCTS' }),
        section({ id: 'b', position: 2, type: 'GALLERY', isEnabled: false }),
        section({ id: 'c', position: 3, type: 'REVIEWS' }),
      ]),
    );

    expect([...needs].sort()).toEqual(['products', 'reviews']);
  });
});

describe('banner windows', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  function banner(overrides: Partial<Banner>): Banner {
    return {
      id: 'b1',
      message: 'Livraison',
      href: null,
      variant: null,
      startsAt: new Date('2026-06-01T00:00:00Z'),
      endsAt: null,
      isActive: true,
      position: 1,
      ...overrides,
    };
  }

  it('shows one that has started and has not ended', () => {
    expect(activeBanners([banner({})], now)).toHaveLength(1);
  });

  it('hides one that has not started, one that has ended, and one switched off', () => {
    const hidden = [
      banner({ id: 'future', startsAt: new Date('2026-07-01T00:00:00Z') }),
      banner({ id: 'past', endsAt: new Date('2026-06-14T00:00:00Z') }),
      banner({ id: 'off', isActive: false }),
    ];

    expect(activeBanners(hidden, now)).toEqual([]);
  });

  it('treats the end instant as over', () => {
    expect(activeBanners([banner({ endsAt: now })], now)).toEqual([]);
  });

  it('orders by position, then deterministically', () => {
    const ordered = activeBanners(
      [banner({ id: 'z', position: 2 }), banner({ id: 'a', position: 1 })],
      now,
    );

    expect(ordered.map((entry) => entry.id)).toEqual(['a', 'z']);
  });
});

describe('the gallery consent rule (13.6)', () => {
  it('allows our own photography, which has no source file', () => {
    expect(
      mayPublishGalleryItem({ sourceDesignFileId: null, customerConsentAt: null }),
    ).toBe(true);
  });

  it('refuses a customer’s design with no recorded consent', () => {
    expect(
      mayPublishGalleryItem({ sourceDesignFileId: 'file-1', customerConsentAt: null }),
    ).toBe(false);

    expect(GALLERY_CONSENT_REFUSAL).toContain('consentement');
  });

  it('allows it once the consent is recorded', () => {
    expect(
      mayPublishGalleryItem({
        sourceDesignFileId: 'file-1',
        customerConsentAt: new Date('2026-01-01T00:00:00Z'),
      }),
    ).toBe(true);
  });
});

describe('gallery filters', () => {
  it('reads a single value and ignores anything else', () => {
    expect(parseGalleryFilters({ productType: 'Polo' }).productType).toBe('Polo');
    expect(parseGalleryFilters({ productType: '' }).productType).toBeNull();
    expect(parseGalleryFilters({ productType: '   ' }).productType).toBeNull();
    expect(parseGalleryFilters({ productType: ['a', 'b'] }).productType).toBeNull();
    expect(parseGalleryFilters({}).productType).toBeNull();
  });

  it('knows when a filter is active', () => {
    expect(hasActiveGalleryFilters(parseGalleryFilters({}))).toBe(false);
    expect(hasActiveGalleryFilters(parseGalleryFilters({ productType: 'Polo' }))).toBe(
      true,
    );
  });

  it('builds a shareable URL, and drops the empty facets', () => {
    expect(galleryHref({ productType: null, embroideryType: null })).toBe('/gallery');
    expect(galleryHref({ productType: 'Polo', embroideryType: null })).toBe(
      '/gallery?productType=Polo',
    );
    expect(galleryHref({ productType: 'Tote bag', embroideryType: 'Motif' })).toBe(
      '/gallery?productType=Tote+bag&embroideryType=Motif',
    );
  });

  it('toggles one facet without disturbing the other', () => {
    const filters = { productType: 'Polo', embroideryType: 'Motif' };

    expect(toggleGalleryFilter(filters, 'productType', 'Polo')).toBe(
      '/gallery?embroideryType=Motif',
    );

    expect(toggleGalleryFilter(filters, 'productType', 'Sweat')).toBe(
      '/gallery?productType=Sweat&embroideryType=Motif',
    );
  });
});

describe('localiseSection', () => {
  const french: HomepageSection = {
    id: 'a',
    type: 'HERO',
    position: 1,
    isEnabled: true,
    title: 'Vos idées, brodées.',
    subtitle: null,
    body: 'Envoyez un logo.',
    ctaLabel: 'Créer ma broderie',
    ctaHref: '/custom',
    imageKey: null,
    config: {
      eyebrow: 'Atelier de broderie',
      note: 'Devis sous 6 heures',
      en: { title: 'Your idea, embroidered.', eyebrow: 'Embroidery workshop' },
    },
  };

  it('returns the row untouched when nothing is translated', () => {
    expect(localiseSection(french, 'fr')).toBe(french);
    expect(localiseSection(french, 'ar')).toBe(french);
  });

  it('overlays what the language provides and keeps the rest', () => {
    const english = localiseSection(french, 'en');

    expect(english.title).toBe('Your idea, embroidered.');
    expect(heroConfig(english.config).eyebrow).toBe('Embroidery workshop');

    // Untranslated fields stay French rather than disappearing.
    expect(english.body).toBe('Envoyez un logo.');
    expect(english.ctaLabel).toBe('Créer ma broderie');
    expect(heroConfig(english.config).note).toBe('Devis sous 6 heures');
  });

  it('does not leave the language key inside the config it hands on', () => {
    const english = localiseSection(french, 'en');

    expect(Object.keys(english.config as Record<string, unknown>)).not.toContain('en');
  });
});

/**
 * The accented word (Phase 16).
 *
 * The emphasis in a marketing heading is content rather than code, because the
 * word that carries it is in a different place in each language. This is the
 * whole of the markup the system understands, which is why the failure modes
 * matter more than the happy path: a typo in a heading must show the heading,
 * never a broken page and never a stray asterisk.
 */
describe('headingSegments', () => {
  it('splits a heading on its emphasised word', () => {
    expect(headingSegments('Vos idées, *brodées.*')).toEqual([
      { text: 'Vos idées, ', accent: false },
      { text: 'brodées.', accent: true },
    ]);
  });

  it('keeps the text on both sides when the emphasis is in the middle', () => {
    expect(headingSegments('A cafe that feels like *home* today')).toEqual([
      { text: 'A cafe that feels like ', accent: false },
      { text: 'home', accent: true },
      { text: ' today', accent: false },
    ]);
  });

  it('leaves a heading with no markup alone', () => {
    expect(headingSegments('Ce que nous avons brodé')).toEqual([
      { text: 'Ce que nous avons brodé', accent: false },
    ]);
  });

  it('shows what was typed when the pair is not closed', () => {
    // A lone asterisk is a typo. Rendering the heading as written is a smaller
    // failure than swallowing half of it.
    expect(headingSegments('Vos idées, *brodées.')).toEqual([
      { text: 'Vos idées, *brodées.', accent: false },
    ]);
  });

  it('ignores an empty emphasis', () => {
    expect(headingSegments('Deux mots ** ici')).toEqual([
      { text: 'Deux mots ** ici', accent: false },
    ]);
  });

  it('interprets only the first pair, and nothing else', () => {
    // Not Markdown. A second pair is literal text, because a heading field
    // that renders arbitrary markup is one somebody puts an image in.
    expect(headingSegments('*un* et *deux*')).toEqual([
      { text: 'un', accent: true },
      { text: ' et *deux*', accent: false },
    ]);
  });

  it('has no segments at all for an absent heading', () => {
    expect(headingSegments(null)).toEqual([]);
  });
});

describe('plainHeading', () => {
  it('strips the markup for places that need a string', () => {
    // A `<title>`, an `aria-label`, a JSON-LD node. An asterisk in a search
    // result is the bug this exists to prevent.
    expect(plainHeading('Vos idées, *brodées.*')).toBe('Vos idées, brodées.');
  });

  it('passes a plain heading through unchanged', () => {
    expect(plainHeading('Notre travail')).toBe('Notre travail');
  });

  it('stays null for an absent heading', () => {
    expect(plainHeading(null)).toBeNull();
  });
});

/**
 * The marquee's phrases (Phase 16).
 *
 * One `longText` field split on newlines rather than a repeater control, so the
 * parsing is where the correctness lives: what a textarea hands over is
 * whatever somebody typed, including the trailing newline it gives you for
 * free.
 */
describe('marqueeConfig', () => {
  it('reads one phrase per line', () => {
    expect(marqueeConfig({ words: 'Brodé main\nPièce unique\nAlger' }).words).toEqual([
      'Brodé main',
      'Pièce unique',
      'Alger',
    ]);
  });

  it('drops blank lines and trims', () => {
    // A trailing newline is what a textarea produces by itself, and an empty
    // item in the strip is a gap nobody can explain.
    expect(marqueeConfig({ words: '  Alger  \n\n\nOran\n' }).words).toEqual([
      'Alger',
      'Oran',
    ]);
  });

  it('caps how many phrases a strip may carry', () => {
    const many = Array.from({ length: 40 }, (_, i) => `mot ${i}`).join('\n');
    expect(marqueeConfig({ words: many }).words).toHaveLength(MAX_MARQUEE_WORDS);
  });

  it('caps the length of one phrase', () => {
    const long = 'x'.repeat(200);
    expect(marqueeConfig({ words: long }).words[0]!.length).toBeLessThanOrEqual(48);
  });

  it('is empty for a band nobody has written yet', () => {
    expect(marqueeConfig({}).words).toEqual([]);
    expect(marqueeConfig(null).words).toEqual([]);
    expect(marqueeConfig({ words: 42 }).words).toEqual([]);
    expect(marqueeConfig({ words: '   \n  ' }).words).toEqual([]);
  });
});
