// @vitest-environment jsdom

/**
 * The builder's client behaviour.
 *
 * These test the *stepper and the state*, not the rules. Whether a
 * configuration needs a quote is a server answer covered by
 * `tests/unit/customization-domain.test.ts` and
 * `tests/integration/custom-request.test.ts`; what this file checks is that the
 * client collects the right things, gates the right steps, and never decides
 * anything it should not.
 */

import { describe, expect, it } from 'vitest';

import {
  INITIAL_STATE,
  STEPS,
  findVariant,
  isPlausibleEmail,
  isStepComplete,
  type BuilderState,
} from '../../src/app/(site)/[locale]/(storefront)/custom/builder-state';
import { fr } from '@/i18n/dictionaries/fr';
import {
  ACCEPTED_TYPES,
  MAX_FILE_BYTES,
  checkFile,
  isPreviewableType,
} from '../../src/app/(site)/[locale]/(storefront)/custom/file-rules';

function state(overrides: Partial<BuilderState> = {}): BuilderState {
  return { ...INITIAL_STATE, ...overrides };
}

function fakeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  // jsdom computes size from the content; override it to test the limit.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('builder state', () => {
  it('holds selections and never a price, estimate or pricing mode', () => {
    // The client cannot conclude anything about money (BUSINESS-RULES 2.3.2),
    // so those fields must not exist on its state to be mistaken for an answer.
    const keys = Object.keys(INITIAL_STATE);

    for (const forbidden of [
      'price',
      'total',
      'estimate',
      'estimateMin',
      'estimateMax',
      'pricingMode',
      'discount',
      'deposit',
    ]) {
      expect(keys, `builder state holds ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('starts empty, at quantity one', () => {
    expect(INITIAL_STATE.productSlug).toBeNull();
    expect(INITIAL_STATE.threadColorIds).toEqual([]);
    expect(INITIAL_STATE.quantity).toBe(1);
    expect(INITIAL_STATE.files).toEqual([]);
  });

  /*
   * Design now comes **before** placement, which is the reverse of the
   * original order and is forced by the feature: you cannot drag a logo onto a
   * hoodie before you have the logo (ADR-035). The old flow asked for a
   * placement *name*, which needed nothing.
   */
  it('mirrors the five documented steps in order', () => {
    expect(STEPS.map((step) => step.id)).toEqual([
      'product',
      'design',
      'placement',
      'options',
      'review',
    ]);
  });
});

describe('step gating', () => {
  it('needs a product before leaving step 1', () => {
    expect(isStepComplete('product', state())).toBe(false);
    expect(isStepComplete('product', state({ productSlug: 't-shirt' }))).toBe(true);
  });

  /*
   * Placement no longer gates anything, and that is deliberate (ADR-035).
   *
   * A blank whose photographs the owner has not measured yet has no placeable
   * face at all. Blocking the customer there would make an unfinished catalogue
   * look like a broken website, so the step passes and the editor says to
   * describe it in the instructions instead — which is what sends the
   * configuration to a human quote.
   */
  it('lets the customer past placement even with nothing to place on', () => {
    expect(isStepComplete('placement', state())).toBe(true);
    expect(isStepComplete('placement', state({ surfaceImageId: 'img1' }))).toBe(true);
  });

  it('accepts text alone as a design — the documented "text only" path', () => {
    expect(isStepComplete('design', state())).toBe(false);
    expect(isStepComplete('design', state({ embroideryText: 'Amina' }))).toBe(true);
    // Whitespace is not a design.
    expect(isStepComplete('design', state({ embroideryText: '   ' }))).toBe(false);
  });

  it('needs a size and at least one colour before leaving step 4', () => {
    const size = { widthMm: 90, heightMm: 45 };

    expect(isStepComplete('options', state({ sizeMm: size }))).toBe(false);
    expect(isStepComplete('options', state({ threadColorIds: ['t1'] }))).toBe(false);
    expect(
      isStepComplete('options', state({ sizeMm: size, threadColorIds: ['t1'] })),
    ).toBe(true);
  });

  /*
   * A placed design *is* a size, so the step must not ask for one again
   * (ADR-035). It used to, with a control the server ignored — the customer
   * dragged a box, read "146 × 37 mm" under it, and was then made to pick
   * "Moyenne" from a list before Continue would light up.
   */
  it('takes the dragged placement as the size, without asking again', () => {
    expect(
      isStepComplete(
        'options',
        state({ surfaceImageId: 'img1', threadColorIds: ['t1'] }),
      ),
    ).toBe(true);
  });

  it('needs a name and a plausible email before submitting', () => {
    expect(isStepComplete('review', state({ contactName: 'Amina' }))).toBe(false);
    expect(
      isStepComplete('review', state({ contactName: 'Amina', contactEmail: 'nope' })),
    ).toBe(false);
    expect(
      isStepComplete(
        'review',
        state({ contactName: 'Amina', contactEmail: 'amina@example.dz' }),
      ),
    ).toBe(true);
  });

  it('treats the email check as a shape check, not validation', () => {
    // The server is authoritative (SECURITY.md section 5); this only keeps the
    // submit button honest before the round trip.
    expect(isPlausibleEmail('a@b.dz')).toBe(true);
    expect(isPlausibleEmail(' a@b.dz ')).toBe(true);
    expect(isPlausibleEmail('a@b')).toBe(false);
    expect(isPlausibleEmail('a b@c.dz')).toBe(false);
    expect(isPlausibleEmail('')).toBe(false);
  });
});

describe('variant matching', () => {
  const product = {
    slug: 't',
    name: 'T',
    category: 'T',
    fromPrice: 4800,
    currency: 'DZD',
    image: null,
    surfaces: [],
    model: null,
    colours: [],
    options: [],
    available: true,
    variants: [
      { sku: 'A-M', options: { Taille: 'M' }, price: 4800, available: true },
      { sku: 'A-L', options: { Taille: 'L' }, price: 5000, available: true },
    ],
  };

  it('finds the variant carrying the chosen options', () => {
    expect(findVariant(product, { Taille: 'L' })?.sku).toBe('A-L');
  });

  it('returns nothing for a combination that does not exist', () => {
    expect(findVariant(product, { Taille: 'XXL' })).toBeUndefined();
    expect(findVariant(undefined, { Taille: 'M' })).toBeUndefined();
  });
});

describe('file pre-checks', () => {
  it('accepts the four documented types', () => {
    for (const type of ACCEPTED_TYPES) {
      expect(checkFile(fakeFile('design', type, 1024), fr.custom), type).toBeNull();
    }
  });

  it('refuses a type that is not accepted', () => {
    expect(
      checkFile(fakeFile('design.gif', 'image/gif', 1024), fr.custom),
    ).not.toBeNull();
    expect(
      checkFile(fakeFile('macro.docx', 'application/msword', 1024), fr.custom),
    ).not.toBeNull();
  });

  it('holds the size limit at exactly 10 MB', () => {
    expect(
      checkFile(fakeFile('a.png', 'image/png', MAX_FILE_BYTES), fr.custom),
    ).toBeNull();
    expect(
      checkFile(fakeFile('a.png', 'image/png', MAX_FILE_BYTES + 1), fr.custom),
    ).not.toBeNull();
  });

  it('refuses an empty file', () => {
    expect(checkFile(fakeFile('a.png', 'image/png', 0), fr.custom)).not.toBeNull();
  });

  it('previews raster only — ADR-011', () => {
    // SVG is the *best* format to send; the absence of a preview is a
    // limitation of the preview, never a problem with the file.
    expect(isPreviewableType('image/png')).toBe(true);
    expect(isPreviewableType('image/jpeg')).toBe(true);
    expect(isPreviewableType('image/svg+xml')).toBe(false);
    expect(isPreviewableType('application/pdf')).toBe(false);
  });

  it('is a convenience, not a security control', () => {
    // The declared MIME type is attacker-controlled: a renamed file passes
    // here and must still be caught by the server (SECURITY.md section 6).
    const spoofed = fakeFile('payload.svg', 'image/png', 1024);
    expect(checkFile(spoofed, fr.custom)).toBeNull();
  });
});
