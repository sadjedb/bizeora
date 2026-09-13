import { describe, expect, it } from 'vitest';

import { en } from '@/i18n/dictionaries/en';
import { fr } from '@/i18n/dictionaries/fr';
import { getDictionary, dictionaryFor } from '@/i18n';
import { DEFAULT_LOCALE, LOCALES, negotiateLocale } from '@/i18n/locales';
import {
  isUnlocalisedPath,
  localeFromPath,
  localiseHref,
  pathWithoutLocale,
  switchLocalePath,
} from '@/i18n/routing';
import { ORDER_STATUS_LABELS } from '@/domain/order/state-machine';
import { QUOTE_STATUS_LABELS } from '@/domain/quote';
import { REQUEST_STATUS_LABELS } from '@/domain/request';
import { PAYMENT_STATUS_LABELS } from '@/domain/order/payment';
import { PAYMENT_METHOD_LABELS } from '@/domain/order/payment-method';
import { REVIEW_STATUS_LABELS } from '@/domain/review';
import { QUOTE_LINE_KIND_LABELS } from '@/domain/quote/pricing';
import { QUOTE_REASON_LABELS } from '@/domain/customization/pricing-mode';

/**
 * The two languages, and the routing that carries them.
 *
 * The dictionaries are checked structurally by the compiler — `en` has to
 * satisfy `typeof fr` — so what is worth testing at runtime is the two things
 * the type system cannot see: that no English value was left as its French
 * original by accident, and that the label maps in `domain/` have not grown a
 * status the storefront cannot name.
 */

type Leaf = string | ((...args: never[]) => string);

function flatten(value: unknown, prefix = ''): Array<[string, Leaf]> {
  if (typeof value === 'string' || typeof value === 'function') {
    return [[prefix, value as Leaf]];
  }

  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      flatten(child, prefix === '' ? key : `${prefix}.${key}`),
    );
  }

  return [];
}

describe('dictionaries', () => {
  it('gives every French key an English one, and no more', () => {
    const french = flatten(fr).map(([key]) => key);
    const english = flatten(en).map(([key]) => key);

    expect(english.sort()).toEqual(french.sort());
  });

  it('translates every string rather than leaving the French in place', () => {
    /**
     * Identical is not the same as untranslated.
     *
     * "Total", "Catalogue", "CCP" and "Stock" are the same word in both
     * languages, and a list of exceptions maintained by hand would grow with
     * every screen and be wrong by the second one. What actually distinguishes
     * an untranslated string is that it is *French*: it carries an accent, an
     * apostrophe or a French function word — or it is long enough that two
     * languages agreeing on it letter for letter would be a coincidence.
     */
    const FRENCH =
      /[àâçéèêëîïôûùüÿœ’]|\b(le|la|les|des|une|vous|nous|pour|dans|est|sont|avec|sans|par|aucun|aucune|cette|votre)\b/i;
    const COINCIDENCE_LIMIT = 24;

    const englishByKey = new Map(flatten(en));

    for (const [key, value] of flatten(fr)) {
      if (typeof value !== 'string') continue;
      if (value.trim() === '') continue;

      const other = englishByKey.get(key);
      expect(typeof other, key).toBe('string');

      if (other !== value) continue;

      expect(FRENCH.test(value), `${key} is still French: ${value}`).toBe(false);
      expect(
        value.length,
        `${key} is too long to be the same in both: ${value}`,
      ).toBeLessThanOrEqual(COINCIDENCE_LIMIT);
    }
  });

  it('names every status the domain can produce', () => {
    const cases: Array<[Record<string, string>, Record<string, string>]> = [
      [ORDER_STATUS_LABELS, fr.labels.orderStatus],
      [QUOTE_STATUS_LABELS, fr.labels.quoteStatus],
      [REQUEST_STATUS_LABELS, fr.labels.requestStatus],
      [PAYMENT_STATUS_LABELS, fr.labels.paymentStatus],
      [PAYMENT_METHOD_LABELS, fr.labels.paymentMethod],
      [REVIEW_STATUS_LABELS, fr.labels.reviewStatus],
      [QUOTE_LINE_KIND_LABELS, fr.labels.quoteLineKind],
      [QUOTE_REASON_LABELS, fr.labels.quoteReason],
    ];

    for (const [domain, dictionary] of cases) {
      for (const key of Object.keys(domain)) {
        expect(Object.keys(dictionary)).toContain(key);
      }
    }
  });

  it('falls back to French for an unknown route parameter', () => {
    expect(dictionaryFor('ar').locale).toBe(DEFAULT_LOCALE);
    expect(dictionaryFor('en').t).toBe(getDictionary('en'));
  });
});

describe('locale negotiation', () => {
  it('prefers the highest-weighted language it speaks', () => {
    expect(negotiateLocale('en-GB,en;q=0.9,fr;q=0.8')).toBe('en');
    expect(negotiateLocale('fr-FR,fr;q=0.9')).toBe('fr');
  });

  it('falls back to French for a language it does not speak', () => {
    expect(negotiateLocale('ar-DZ,ar;q=0.9')).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale(null)).toBe(DEFAULT_LOCALE);
  });
});

describe('routing', () => {
  it('leaves the workshop, the API and static files unprefixed', () => {
    expect(isUnlocalisedPath('/admin/orders')).toBe(true);
    expect(isUnlocalisedPath('/api/jobs/notifications')).toBe(true);
    expect(isUnlocalisedPath('/assets/site/hero.jpg')).toBe(true);
    expect(isUnlocalisedPath('/sitemap.xml')).toBe(true);
    expect(isUnlocalisedPath('/shop')).toBe(false);
  });

  it('prefixes an internal href once', () => {
    expect(localiseHref('/shop', 'en')).toBe('/en/shop');
    expect(localiseHref('/en/shop', 'en')).toBe('/en/shop');
    expect(localiseHref('/', 'fr')).toBe('/fr');
    expect(localiseHref('/admin', 'fr')).toBe('/admin');
    expect(localiseHref('/shop', null)).toBe('/shop');
    expect(localiseHref('https://example.com', 'fr')).toBe('https://example.com');
  });

  it('keeps the visitor on the same page when the language changes', () => {
    expect(switchLocalePath('/fr/shop/tote-lin', 'en')).toBe('/en/shop/tote-lin');
    expect(switchLocalePath('/fr', 'en')).toBe('/en');
  });

  it('reads and removes the prefix', () => {
    expect(localeFromPath('/en/cart')).toBe('en');
    expect(localeFromPath('/admin')).toBeNull();
    expect(pathWithoutLocale('/en/cart')).toBe('/cart');
    expect(pathWithoutLocale('/fr')).toBe('/');
  });

  it('covers every declared locale', () => {
    for (const locale of LOCALES) {
      expect(localiseHref('/gallery', locale)).toBe(`/${locale}/gallery`);
    }
  });
});
