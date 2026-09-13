/**
 * What an owner may change, and what a valid value is.
 *
 * These rules stand between a form and the numbers every price in the shop is
 * computed from. A deposit of 150 % produces an order that can never be paid; a
 * blank brand name is a page whose title is a dash. So the bounds are tested
 * against the two values on either side of each edge rather than against one
 * comfortable case in the middle.
 */

import { describe, expect, it } from 'vitest';

import {
  EDITABLE_SETTINGS,
  booleanSetting,
  editableSetting,
  parseEmailList,
  validateSetting,
  validateSettings,
} from '../../src/domain/settings';

describe('what the screen offers', () => {
  it('has a unique key for every setting', () => {
    const keys = EDITABLE_SETTINGS.map((setting) => setting.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every numeric setting both bounds', () => {
    for (const setting of EDITABLE_SETTINGS) {
      if (['NUMBER', 'MONEY', 'PERCENT'].includes(setting.kind)) {
        expect(setting.min, setting.key).toBeTypeOf('number');
        expect(setting.max, setting.key).toBeTypeOf('number');
      }
    }
  });

  /*
   * A key that is not on the list is not a setting the screen offers, and
   * writing it would let a crafted request change a row nobody put behind a
   * control — `custom_orders.maxThreadColors` is a safety limit, not a
   * preference, and it is deliberately absent.
   */
  it.each([
    'custom_orders.maxThreadColors',
    'custom_orders.quoteThresholdQuantity',
    'brand.logoKey',
    'features.wishlist',
    '__proto__',
    '',
  ])('refuses to write %o', (key) => {
    expect(editableSetting(key)).toBeNull();
    expect(validateSetting(key, 'anything')).toBe('UNKNOWN_KEY');
  });
});

describe('text', () => {
  it('requires a brand name', () => {
    expect(validateSetting('brand.name', 'Bizeora')).toBeNull();
    expect(validateSetting('brand.name', '')).toBe('REQUIRED');
    expect(validateSetting('brand.name', '   ')).toBe('REQUIRED');
  });

  it('caps its length', () => {
    expect(validateSetting('brand.name', 'x'.repeat(60))).toBeNull();
    expect(validateSetting('brand.name', 'x'.repeat(61))).toBe('TOO_LONG');
  });

  /*
   * An optional setting's empty value is an answer, not a gap. "No WhatsApp
   * number" is a real state and it must be expressible.
   */
  it('lets an optional one be blank', () => {
    expect(validateSetting('contact.whatsapp', '')).toBeNull();
    expect(validateSetting('contact.whatsapp', '0555 12 34 56')).toBeNull();
  });
});

describe('the workshop’s own addresses', () => {
  it('accepts one, several, and none', () => {
    expect(validateSetting('notifications.adminRecipients', '')).toBeNull();
    expect(validateSetting('notifications.adminRecipients', 'a@b.com')).toBeNull();
    expect(
      validateSetting('notifications.adminRecipients', 'a@b.com, c@d.dz'),
    ).toBeNull();
  });

  it('refuses one that is not an address', () => {
    expect(validateSetting('notifications.adminRecipients', 'pas-un-email')).toBe(
      'BAD_EMAIL',
    );
    // One bad apple in a good list is still a refusal: a half-delivered
    // notification is worse than a rejected form.
    expect(validateSetting('notifications.adminRecipients', 'a@b.com, nope')).toBe(
      'BAD_EMAIL',
    );
  });

  it('splits on commas, semicolons and spaces, because people type all three', () => {
    expect([...parseEmailList('a@b.com, c@d.dz; e@f.org  g@h.net')]).toEqual([
      'a@b.com',
      'c@d.dz',
      'e@f.org',
      'g@h.net',
    ]);

    expect([...parseEmailList('   ')]).toEqual([]);
  });
});

describe('switches', () => {
  it('accepts only the two words it stores', () => {
    expect(validateSetting('site.storefrontEnabled', 'true')).toBeNull();
    expect(validateSetting('site.storefrontEnabled', 'false')).toBeNull();

    for (const value of ['1', 'oui', 'TRUE', 'on', '']) {
      expect(validateSetting('site.storefrontEnabled', value), value).toBe(
        'NOT_A_BOOLEAN',
      );
    }
  });

  /*
   * An absent row is not a false one.
   *
   * A setting that has never been seeded is missing, and both of these default
   * to *true* — so an incomplete database behaves like a cautious one: the shop
   * is open and verification is required, rather than silently the reverse.
   */
  it('falls back rather than guessing', () => {
    expect(booleanSetting(undefined, true)).toBe(true);
    expect(booleanSetting(null, true)).toBe(true);
    expect(booleanSetting('nonsense', true)).toBe(true);
    expect(booleanSetting('false', true)).toBe(false);
    expect(booleanSetting('true', false)).toBe(true);
  });
});

describe('numbers, money and percentages', () => {
  it('takes integers only', () => {
    expect(validateSetting('custom_orders.setupFee', '1200')).toBeNull();
    expect(validateSetting('custom_orders.setupFee', '1200.5')).toBe('NOT_A_NUMBER');
    expect(validateSetting('custom_orders.setupFee', '1 200')).toBe('NOT_A_NUMBER');
    expect(validateSetting('custom_orders.setupFee', 'gratuit')).toBe('NOT_A_NUMBER');
  });

  it('holds the deposit between nothing and everything', () => {
    // Basis points: 10 000 is 100 %, which is "pay it all up front".
    expect(validateSetting('custom_orders.depositPercent', '0')).toBeNull();
    expect(validateSetting('custom_orders.depositPercent', '5000')).toBeNull();
    expect(validateSetting('custom_orders.depositPercent', '10000')).toBeNull();

    // 150 % is an order that can never be paid.
    expect(validateSetting('custom_orders.depositPercent', '15000')).toBe('OUT_OF_RANGE');
    expect(validateSetting('custom_orders.depositPercent', '-1')).toBe('OUT_OF_RANGE');
  });

  /*
   * The response time is a promise printed on the front page. Zero hours is a
   * promise the shop breaks by existing.
   */
  it('keeps the response promise possible', () => {
    expect(validateSetting('custom_orders.responseTimeHours', '0')).toBe('OUT_OF_RANGE');
    expect(validateSetting('custom_orders.responseTimeHours', '1')).toBeNull();
    expect(validateSetting('custom_orders.responseTimeHours', '168')).toBeNull();
    expect(validateSetting('custom_orders.responseTimeHours', '169')).toBe(
      'OUT_OF_RANGE',
    );
  });
});

describe('a whole submission', () => {
  it('is silent when everything is good', () => {
    expect(
      validateSettings({
        'brand.name': 'Bizeora',
        'custom_orders.setupFee': '1200',
        'site.storefrontEnabled': 'true',
      }),
    ).toEqual({});
  });

  /*
   * Every bad field at once. A settings form that reveals one problem per save
   * is a form that takes six saves.
   */
  it('reports every bad field, keyed by setting', () => {
    expect(
      validateSettings({
        'brand.name': '',
        'custom_orders.depositPercent': '20000',
        'notifications.adminRecipients': 'nope',
        'custom_orders.setupFee': '1200',
      }),
    ).toEqual({
      'brand.name': 'REQUIRED',
      'custom_orders.depositPercent': 'OUT_OF_RANGE',
      'notifications.adminRecipients': 'BAD_EMAIL',
    });
  });

  it('reports an unknown key rather than dropping it', () => {
    expect(validateSettings({ 'custom_orders.maxThreadColors': '99' })).toEqual({
      'custom_orders.maxThreadColors': 'UNKNOWN_KEY',
    });
  });
});
