/**
 * Bizeora — deterministic seed.
 *
 * Seeds the reference and configuration data the platform cannot run without
 * (DATABASE.md section 19). Every value comes from the documentation; nothing
 * here is invented.
 *
 * Idempotent: every write is an upsert keyed on a natural key, so running the
 * seed repeatedly converges on the same state and never duplicates a row.
 * Deterministic: no random values, no timestamps derived from `now()` beyond
 * the columns the database defaults, and fixed ordering.
 *
 * The demo catalogue arrived in Phase 6: categories, products, options,
 * variants and image records, enough to exercise every storefront read path.
 * It is development content, clearly marked as such, and carries no claim the
 * business has not made — no reviews, no ratings, no invented stock figures
 * presented as real.
 *
 * Still NOT seeded: an admin user, placements, embroidery sizes, thread
 * colours, fonts and the customisation profile. Those need real business
 * content and image assets that do not exist yet (DATABASE.md section 19), and
 * they belong to the phases that introduce them.
 *
 * No authentication fixtures either. The seed creates no users, sessions,
 * accounts or verification rows, and in particular no password values: an
 * admin account is a real credential, and Better Auth owns creating it
 * (DATABASE.md section 4, ADR-006). Phase 3 provisions it through the library
 * so the Argon2id hash lands on the credential account row rather than being
 * hand-written here.
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';
import dotenv from 'dotenv';

import { Prisma, PrismaClient, SettingType } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { HOMEPAGE_SECTIONS } from './homepage-sections';
import {
  DEMO_MODEL_KEY,
  DEMO_MODEL_MATERIAL,
  DEMO_MODEL_PRODUCT_SLUG,
} from '../scripts/demo-model';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DIRECT_URL (or DATABASE_URL) must be set to run the seed. See .env.example.',
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// ---------------------------------------------------------------------------
// Wilayas — the 58 Algerian provinces (DATABASE.md section 4)
// ---------------------------------------------------------------------------

const WILAYAS: ReadonlyArray<readonly [number, string, string]> = [
  [1, 'Adrar', 'أدرار'],
  [2, 'Chlef', 'الشلف'],
  [3, 'Laghouat', 'الأغواط'],
  [4, 'Oum El Bouaghi', 'أم البواقي'],
  [5, 'Batna', 'باتنة'],
  [6, 'Béjaïa', 'بجاية'],
  [7, 'Biskra', 'بسكرة'],
  [8, 'Béchar', 'بشار'],
  [9, 'Blida', 'البليدة'],
  [10, 'Bouira', 'البويرة'],
  [11, 'Tamanrasset', 'تمنراست'],
  [12, 'Tébessa', 'تبسة'],
  [13, 'Tlemcen', 'تلمسان'],
  [14, 'Tiaret', 'تيارت'],
  [15, 'Tizi Ouzou', 'تيزي وزو'],
  [16, 'Alger', 'الجزائر'],
  [17, 'Djelfa', 'الجلفة'],
  [18, 'Jijel', 'جيجل'],
  [19, 'Sétif', 'سطيف'],
  [20, 'Saïda', 'سعيدة'],
  [21, 'Skikda', 'سكيكدة'],
  [22, 'Sidi Bel Abbès', 'سيدي بلعباس'],
  [23, 'Annaba', 'عنابة'],
  [24, 'Guelma', 'قالمة'],
  [25, 'Constantine', 'قسنطينة'],
  [26, 'Médéa', 'المدية'],
  [27, 'Mostaganem', 'مستغانم'],
  [28, "M'Sila", 'المسيلة'],
  [29, 'Mascara', 'معسكر'],
  [30, 'Ouargla', 'ورقلة'],
  [31, 'Oran', 'وهران'],
  [32, 'El Bayadh', 'البيض'],
  [33, 'Illizi', 'إليزي'],
  [34, 'Bordj Bou Arréridj', 'برج بوعريريج'],
  [35, 'Boumerdès', 'بومرداس'],
  [36, 'El Tarf', 'الطارف'],
  [37, 'Tindouf', 'تندوف'],
  [38, 'Tissemsilt', 'تيسمسيلت'],
  [39, 'El Oued', 'الوادي'],
  [40, 'Khenchela', 'خنشلة'],
  [41, 'Souk Ahras', 'سوق أهراس'],
  [42, 'Tipaza', 'تيبازة'],
  [43, 'Mila', 'ميلة'],
  [44, 'Aïn Defla', 'عين الدفلى'],
  [45, 'Naâma', 'النعامة'],
  [46, 'Aïn Témouchent', 'عين تموشنت'],
  [47, 'Ghardaïa', 'غرداية'],
  [48, 'Relizane', 'غليزان'],
  [49, 'Timimoun', 'تيميمون'],
  [50, 'Bordj Badji Mokhtar', 'برج باجي مختار'],
  [51, 'Ouled Djellal', 'أولاد جلال'],
  [52, 'Béni Abbès', 'بني عباس'],
  [53, 'In Salah', 'عين صالح'],
  [54, 'In Guezzam', 'عين قزام'],
  [55, 'Touggourt', 'تقرت'],
  [56, 'Djanet', 'جانت'],
  [57, "El M'Ghair", 'المغير'],
  [58, 'El Meniaa', 'المنيعة'],
] as const;

// ---------------------------------------------------------------------------
// Shipping zones (DATABASE.md section 14)
//
// Prices are PLACEHOLDERS pending the owner's real rates — recorded as open
// decision 5 in tasks/CURRENT.md. The structure is correct; the numbers are not
// yet commercial.
//
// **They are whole dinars, like every other money column this application
// displays.** They used to be written as centimes (60 000 for 600 DA), which
// was a hundredfold error everywhere it was shown: `components/commerce/price`
// renders the stored integer with zero fraction digits, so a checkout charged
// 60 000 DA of delivery on a 6 400 DA order and the total was mostly postage.
// Phase 14.6's end-to-end journey is what surfaced it. Product prices in this
// same file were always whole dinars (4 800 for a t-shirt), so the two halves
// of the seed disagreed about the unit — the concrete form of the ADR-012
// naming discrepancy Phase 14 recorded as open.
// ---------------------------------------------------------------------------

const SHIPPING_ZONES = [
  {
    name: 'Nord',
    position: 1,
    wilayas: [
      2, 6, 9, 10, 13, 15, 16, 18, 19, 21, 22, 23, 24, 25, 26, 27, 29, 31, 34, 35, 36, 41,
      42, 43, 44, 46, 48,
    ],
    rates: [
      { deliveryType: 'HOME' as const, price: 600, minDays: 2, maxDays: 4 },
      { deliveryType: 'DESK' as const, price: 400, minDays: 2, maxDays: 4 },
    ],
  },
  {
    name: 'Hauts-Plateaux',
    position: 2,
    wilayas: [3, 4, 5, 12, 14, 17, 20, 28, 32, 38, 40, 45, 51],
    rates: [
      { deliveryType: 'HOME' as const, price: 750, minDays: 3, maxDays: 6 },
      { deliveryType: 'DESK' as const, price: 550, minDays: 3, maxDays: 6 },
    ],
  },
  {
    name: 'Sud',
    position: 3,
    wilayas: [1, 7, 8, 11, 30, 33, 37, 39, 47, 49, 50, 52, 53, 54, 55, 56, 57, 58],
    rates: [
      { deliveryType: 'HOME' as const, price: 1_100, minDays: 5, maxDays: 10 },
      { deliveryType: 'DESK' as const, price: 850, minDays: 5, maxDays: 10 },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Discount tiers — ADR-017, DATABASE.md section 12.
// Percentages are basis points (ADR-018).
// ---------------------------------------------------------------------------

const DISCOUNT_TIERS = [
  { minQuantity: 1, maxQuantity: 9, discountBasisPoints: 0, label: '1–9 pieces' },
  { minQuantity: 10, maxQuantity: 24, discountBasisPoints: 500, label: '10–24 pieces' },
  { minQuantity: 25, maxQuantity: 49, discountBasisPoints: 1000, label: '25–49 pieces' },
  {
    minQuantity: 50,
    maxQuantity: null,
    discountBasisPoints: 1500,
    label: '50 pieces or more',
  },
] as const;

// ---------------------------------------------------------------------------
// Settings — DATABASE.md section 14, exhaustive for the custom_orders group.
// ---------------------------------------------------------------------------

interface SeedSetting {
  key: string;
  value: string;
  type: SettingType;
  group: string;
  label: string;
  description?: string;
}

const SETTINGS: readonly SeedSetting[] = [
  {
    key: 'brand.name',
    value: 'Bizeora',
    type: SettingType.STRING,
    group: 'brand',
    label: 'Brand name',
    description:
      'Temporary placeholder. Replacing it also means editing config/brand.ts.',
  },
  {
    key: 'brand.logoKey',
    value: '',
    type: SettingType.STRING,
    group: 'brand',
    label: 'Logo asset key',
    description:
      'Public bucket key. Empty falls back to the bundled asset in config/brand.ts.',
  },
  {
    key: 'contact.whatsapp',
    value: '',
    type: SettingType.STRING,
    group: 'contact',
    label: 'WhatsApp number',
    description: 'E.164. Drives the floating contact button and quote follow-up links.',
  },
  {
    key: 'shipping.defaultFreeThreshold',
    value: '0',
    type: SettingType.MONEY,
    group: 'shipping',
    label: 'Default free-delivery threshold',
    description:
      'Creation default only. Never read at calculation time — shipping_rates.freeOverAmount is the sole runtime source (BUSINESS-RULES.md 4.2).',
  },
  {
    key: 'custom_orders.depositPercent',
    value: '5000',
    type: SettingType.NUMBER,
    group: 'custom_orders',
    label: 'Deposit percentage',
    description: 'BASIS POINTS. 5000 = 50%. Never a fraction (ADR-018).',
  },
  {
    key: 'custom_orders.quoteValidityDays',
    value: '14',
    type: SettingType.NUMBER,
    group: 'custom_orders',
    label: 'Quote validity (days)',
    description: 'How long an unanswered quote may be accepted (BUSINESS-RULES.md 7.4).',
  },
  {
    key: 'custom_orders.acceptanceValidityDays',
    value: '7',
    type: SettingType.NUMBER,
    group: 'custom_orders',
    label: 'Acceptance validity (days)',
    description:
      'How long an accepted quote stays checkout-valid (BUSINESS-RULES.md 7.10).',
  },
  {
    key: 'custom_orders.responseTimeHours',
    value: '6',
    type: SettingType.NUMBER,
    group: 'custom_orders',
    label: 'Stated response time (working hours)',
    description: 'Shown to customers on the request confirmation screen.',
  },
  {
    key: 'custom_orders.quoteThresholdQuantity',
    value: '10',
    type: SettingType.NUMBER,
    group: 'custom_orders',
    label: 'Fixed-price quantity threshold',
    description: 'Above this a configuration needs a quote (BUSINESS-RULES.md 2.3.5).',
  },
  {
    key: 'custom_orders.quoteThresholdThreadColors',
    value: '3',
    type: SettingType.NUMBER,
    group: 'custom_orders',
    label: 'Fixed-price thread-colour threshold',
    description: 'Above this a configuration needs a quote (BUSINESS-RULES.md 2.3.4).',
  },
  {
    key: 'custom_orders.quoteThresholdInstructionLength',
    value: '200',
    type: SettingType.NUMBER,
    group: 'custom_orders',
    label: 'Fixed-price instruction-length threshold',
    description:
      'At or above this character count a configuration needs a quote (BUSINESS-RULES.md 2.3.6).',
  },
  {
    key: 'custom_orders.maxThreadColors',
    value: '8',
    type: SettingType.NUMBER,
    group: 'custom_orders',
    label: 'Maximum selectable thread colours',
    description:
      'Hard configuration limit (BUSINESS-RULES.md 9.6). Distinct from the quote threshold of 3.',
  },
  {
    key: 'custom_orders.estimateBandPercent',
    value: '1500',
    type: SettingType.NUMBER,
    group: 'custom_orders',
    label: 'Estimate range band',
    description: 'BASIS POINTS. 1500 = 15% (BUSINESS-RULES.md 2.4.2).',
  },
  {
    key: 'custom_orders.threadColorSurchargePerColor',
    value: '150',
    type: SettingType.MONEY,
    group: 'custom_orders',
    label: 'Thread colour surcharge, per colour beyond the first',
    description:
      'PLACEHOLDER pending the owner. Minor units. The per-colour rate BUSINESS-RULES.md 2.2 reads from settings.',
  },
  {
    key: 'custom_orders.textSurcharge',
    value: '250',
    type: SettingType.MONEY,
    group: 'custom_orders',
    label: 'Embroidered text surcharge, per unit',
    description:
      'PLACEHOLDER pending the owner. Minor units. Applied once per unit when the configuration carries text (BUSINESS-RULES.md 2.2).',
  },
  {
    key: 'custom_orders.setupFee',
    value: '1200',
    type: SettingType.MONEY,
    group: 'custom_orders',
    label: 'Digitising setup fee, per configuration',
    description:
      'PLACEHOLDER pending the owner. Minor units. Charged ONCE per configuration, not per unit, and waived above the quantity below (BUSINESS-RULES.md 2.2).',
  },
  {
    key: 'custom_orders.setupFeeWaiverQuantity',
    value: '25',
    type: SettingType.NUMBER,
    group: 'custom_orders',
    label: 'Setup fee waiver quantity',
    description:
      'PLACEHOLDER pending the owner. At or above this quantity the setup fee is waived (BUSINESS-RULES.md 2.2).',
  },
  {
    key: 'custom_orders.depositWindowDays',
    value: '7',
    type: SettingType.NUMBER,
    group: 'custom_orders',
    label: 'Deposit follow-up window (days)',
    description:
      'PLACEHOLDER pending the owner. After this an unpaid deposit order is flagged for follow-up; it is never auto-cancelled (BUSINESS-RULES.md 8.10.5).',
  },
  {
    key: 'notifications.adminRecipients',
    value: '',
    type: SettingType.STRING,
    group: 'notifications',
    label: 'Workshop notification addresses',
    description:
      'Comma-separated. Recipients of request.submitted, order.placed and quote.expiring ' +
      '(ARCHITECTURE.md section 11). PLACEHOLDER pending the owner: while it is empty the ' +
      'ADMIN_NOTIFICATION_EMAIL variable is used, and with neither set staff notifications are ' +
      'recorded as SKIPPED rather than silently dropped.',
  },
  {
    key: 'site.storefrontEnabled',
    value: 'true',
    type: SettingType.BOOLEAN,
    group: 'availability',
    label: 'Storefront open',
    description:
      'When false the public site shows a "we will be back" page instead of the shop. ' +
      '/admin is unaffected, and staff still see the real site with a banner so the owner ' +
      'can check their own shop while it is closed. Defaults to open: an absent row must ' +
      'never read as a closed shop.',
  },
  {
    key: 'accounts.emailVerificationRequired',
    value: 'true',
    type: SettingType.BOOLEAN,
    group: 'accounts',
    label: 'Require e-mail verification',
    description:
      'When false every signed-in customer is treated as verified, which unblocks quote ' +
      'acceptance for a shop with no mail provider configured. Defaults to true: an absent ' +
      'row must never quietly switch a security control off.',
  },
  {
    key: 'features.wishlist',
    value: 'false',
    type: SettingType.BOOLEAN,
    group: 'features',
    label: 'Wishlist enabled',
    description: 'V1.5 feature flag.',
  },
];

// ---------------------------------------------------------------------------

async function seedWilayas(): Promise<number> {
  for (const [code, nameFr, nameAr] of WILAYAS) {
    await prisma.wilaya.upsert({
      where: { code },
      create: { code, nameFr, nameAr },
      update: { nameFr, nameAr },
    });
  }
  return WILAYAS.length;
}

async function seedShipping(): Promise<number> {
  for (const zone of SHIPPING_ZONES) {
    const existing = await prisma.shippingZone.findFirst({
      where: { name: zone.name },
    });

    const record = existing
      ? await prisma.shippingZone.update({
          where: { id: existing.id },
          data: { position: zone.position },
        })
      : await prisma.shippingZone.create({
          data: { name: zone.name, position: zone.position },
        });

    for (const wilayaCode of zone.wilayas) {
      await prisma.shippingZoneWilaya.upsert({
        where: { wilayaCode },
        create: { zoneId: record.id, wilayaCode },
        update: { zoneId: record.id },
      });
    }

    for (const rate of zone.rates) {
      await prisma.shippingRate.upsert({
        where: {
          zoneId_deliveryType: { zoneId: record.id, deliveryType: rate.deliveryType },
        },
        create: {
          zoneId: record.id,
          deliveryType: rate.deliveryType,
          price: rate.price,
          estimatedMinDays: rate.minDays,
          estimatedMaxDays: rate.maxDays,
        },
        update: {
          price: rate.price,
          estimatedMinDays: rate.minDays,
          estimatedMaxDays: rate.maxDays,
        },
      });
    }
  }

  return SHIPPING_ZONES.length;
}

async function seedDiscountTiers(): Promise<number> {
  for (const tier of DISCOUNT_TIERS) {
    const existing = await prisma.discountTier.findFirst({
      where: { minQuantity: tier.minQuantity, isActive: true },
    });

    if (existing) {
      await prisma.discountTier.update({
        where: { id: existing.id },
        data: {
          maxQuantity: tier.maxQuantity,
          discountBasisPoints: tier.discountBasisPoints,
          label: tier.label,
        },
      });
    } else {
      await prisma.discountTier.create({ data: { ...tier } });
    }
  }

  return DISCOUNT_TIERS.length;
}

async function seedSettings(): Promise<number> {
  for (const setting of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      create: {
        key: setting.key,
        value: setting.value,
        type: setting.type,
        group: setting.group,
        label: setting.label,
        description: setting.description ?? null,
      },
      // `value` is intentionally NOT overwritten: the owner may have changed it
      // from the admin, and a re-seed must not silently reset business
      // configuration. Only the descriptive metadata is refreshed.
      update: {
        type: setting.type,
        group: setting.group,
        label: setting.label,
        description: setting.description ?? null,
      },
    });
  }

  return SETTINGS.length;
}

// ---------------------------------------------------------------------------
// Demo catalogue (DATABASE.md section 19)
//
// Development content, not inventory. It exists so the storefront's listing,
// detail, variant, availability and related-product paths can be exercised
// against real rows rather than a fixture module. Every price is plausible for
// the Algerian market and every description is about the product; none of it
// carries a claim the business has not made — no reviews, no ratings, no
// "as seen in", no stock figures presented as real.
//
// Photography does not exist yet, so `storageKey` points at the path an image
// *will* occupy in the public bucket (Phase 9). Until that bucket exists,
// `toPublicAssetUrl` resolves every key to null and the media primitives render
// their placeholder — which is why the alt text still matters and is written
// properly here.
//
// Deterministic and idempotent: products are keyed on slug, options on
// (product, name), values on (option, value), variants on SKU, and images on
// (product, position). Re-running converges rather than duplicating.
// ---------------------------------------------------------------------------

type SeedVariant = {
  /** Option name -> value. Must match the product's declared options. */
  options: Record<string, string>;
  skuSuffix: string;
  priceOverride?: number;
  stockQuantity?: number;
  isActive?: boolean;
};

type SeedProduct = {
  slug: string;
  name: string;
  subtitle?: string;
  description: string;
  categorySlug: string;
  basePrice: number;
  compareAtPrice?: number;
  stockPolicy: 'TRACK' | 'DONT_TRACK' | 'MADE_TO_ORDER';
  material?: string;
  careInstructions?: string;
  embroideryDetails?: string;
  isCustomizable?: boolean;
  isNewArrival?: boolean;
  isBestSeller?: boolean;
  /**
   * Leads the catalogue listing.
   *
   * Not a new ordering rule — the listing is ordered by `publishedAt desc` and
   * uses the `(status, published_at desc)` index for it. A featured product is
   * simply published a day later, so the shop's first row is the work the
   * business most wants seen, which right now is the two blanks that have real
   * photography rather than a placeholder.
   */
  isFeatured?: boolean;
  options: { name: string; values: { value: string; hexColor?: string }[] }[];
  variants: SeedVariant[];
  images: {
    alt: string;
    /**
     * Which face of the garment this photograph shows.
     *
     * Set it and the picture becomes something a customer can drop a design
     * onto in the builder (ADR-035); leave it off and it is an ordinary
     * catalogue picture. Only the blanks that have real, straight-on, flat
     * photography carry one — a three-quarter shot of a folded hoodie is a
     * lovely product picture and a hopeless placement surface, because the
     * percentage-to-millimetre conversion assumes the garment's width maps
     * linearly across the frame.
     */
    surface?: 'FRONT' | 'BACK';
  }[];
  /**
   * How wide the garment really is across a photograph of it, in millimetres.
   *
   * The one measurement the visual placement editor rests on (ADR-035): a
   * design covering a sixth of the picture covers a sixth of the garment, and
   * everything the customer is shown in millimetres is derived from it. Set on
   * the **first** image, which the seed marks as the front face.
   *
   * These are placeholder measurements in the same sense as the placeholder
   * prices — structurally correct, and the owner replaces them with a tape
   * measure. Absent means the product's photographs are not placeable and every
   * request for it goes to a human quote, which is the correct behaviour for a
   * blank nobody has measured.
   */
  surfaceWidthMm?: number;
};

const CATEGORIES: ReadonlyArray<{
  slug: string;
  name: string;
  description: string;
  position: number;
}> = [
  {
    slug: 't-shirts',
    name: 'T-shirts',
    description: 'Coton peigné, brodé après montage.',
    position: 1,
  },
  {
    slug: 'sweats',
    name: 'Sweats',
    description: 'Molleton gratté, capuche doublée.',
    position: 2,
  },
  {
    slug: 'polos',
    name: 'Polos',
    description: 'Piqué de coton, col tricoté.',
    position: 3,
  },
  {
    slug: 'accessoires',
    name: 'Accessoires',
    description: 'Casquettes, bonnets et sacs en toile.',
    position: 4,
  },
];

const SIZES = ['S', 'M', 'L', 'XL'];

const INK = '#12100e';
/**
 * The colour the photography actually shows.
 *
 * The two blanks with real pictures are white, and a chip reading "Noir encre"
 * over a photograph of a white t-shirt is the sort of detail a customer notices
 * before they notice anything else. White is first on both, which makes it the
 * default selection and the one the picture agrees with.
 */
const WHITE = '#ffffff';
const ECRU = '#f6f2ec';
const NAVY = '#2b4a6f';
const OLIVE = '#1f5b3f';
const OCHRE = '#9a4e26';

const PRODUCTS: readonly SeedProduct[] = [
  {
    slug: 't-shirt-brode-classique',
    surfaceWidthMm: 620,
    isFeatured: true,
    name: 'T-shirt brodé classique',
    subtitle: 'Coupe droite, broderie poitrine',
    description:
      'Coton peigné 180 g/m² à la maille serrée, coupe droite, col côtelé renforcé par une bande de propreté. La broderie est réalisée après montage, sur la pièce finie, ce qui permet de la placer précisément.',
    categorySlug: 't-shirts',
    basePrice: 4800,
    compareAtPrice: 6000,
    stockPolicy: 'TRACK',
    material: '100 % coton peigné, 180 g/m²',
    careInstructions: 'Lavage 30°, sur l’envers, sans sèche-linge',
    embroideryDetails:
      'Broderie poitrine gauche, fil polyester haute ténacité, jusqu’à 3 couleurs.',
    isCustomizable: true,
    isBestSeller: true,
    options: [
      { name: 'Taille', values: SIZES.map((value) => ({ value })) },
      {
        name: 'Couleur',
        values: [
          { value: 'Blanc', hexColor: WHITE },
          { value: 'Noir encre', hexColor: INK },
          { value: 'Écru', hexColor: ECRU },
          { value: 'Bleu nuit', hexColor: NAVY },
        ],
      },
    ],
    variants: SIZES.flatMap((size) =>
      [
        { colour: 'Blanc', code: 'BLA' },
        { colour: 'Noir encre', code: 'NOI' },
        { colour: 'Écru', code: 'ECR' },
        { colour: 'Bleu nuit', code: 'BLN' },
      ].map(({ colour, code }) => ({
        options: { Taille: size, Couleur: colour },
        skuSuffix: `${code}-${size}`,
        // One combination is deliberately out of stock so the storefront's
        // unavailable path is exercised by real data.
        stockQuantity: size === 'S' && colour === 'Écru' ? 0 : 12,
      })),
    ),
    images: [
      { alt: 'T-shirt blanc vierge, vue de face', surface: 'FRONT' },
      { alt: 'T-shirt blanc vierge, vue de dos', surface: 'BACK' },
      { alt: 'Deux t-shirts brodés, l’un bleu nuit, l’autre noir' },
      { alt: 'T-shirt blanc brodé de logos de sport automobile' },
    ],
  },
  {
    slug: 'sweat-capuche-brode',
    surfaceWidthMm: 640,
    isFeatured: true,
    name: 'Sweat à capuche brodé',
    subtitle: 'Molleton 320 g/m²',
    description:
      'Molleton gratté 320 g/m², capuche doublée en jersey, poche kangourou et bord-côtes élasthanne aux poignets. La pièce la plus demandée pour les commandes en série.',
    categorySlug: 'sweats',
    basePrice: 9200,
    stockPolicy: 'TRACK',
    material: '80 % coton, 20 % polyester, 320 g/m²',
    careInstructions: 'Lavage 30°, sur l’envers, sans sèche-linge',
    embroideryDetails: 'Broderie poitrine ou dos, jusqu’à 15 cm de large.',
    isCustomizable: true,
    options: [
      { name: 'Taille', values: SIZES.map((value) => ({ value })) },
      {
        name: 'Couleur',
        values: [
          { value: 'Blanc', hexColor: WHITE },
          { value: 'Noir encre', hexColor: INK },
          { value: 'Vert olive', hexColor: OLIVE },
        ],
      },
    ],
    variants: SIZES.flatMap((size) =>
      [
        { colour: 'Blanc', code: 'BLA' },
        { colour: 'Noir encre', code: 'NOI' },
        { colour: 'Vert olive', code: 'OLI' },
      ].map(({ colour, code }) => ({
        options: { Taille: size, Couleur: colour },
        skuSuffix: `${code}-${size}`,
        stockQuantity: 8,
      })),
    ),
    images: [
      { alt: 'Sweat à capuche blanc vierge, vue de face', surface: 'FRONT' },
      { alt: 'Sweat à capuche blanc vierge, vue de dos', surface: 'BACK' },
      { alt: 'Sweat à capuche écru avec un logo brodé en poitrine' },
      { alt: 'Dos d’un sweat à capuche noir avec une dague brodée' },
    ],
  },
  {
    slug: 'polo-pique-brode',
    name: 'Polo piqué brodé',
    description:
      'Piqué de coton 220 g/m², col et bord-côte tricotés, patte trois boutons nacrés. Le vêtement des commandes d’entreprise, où la broderie remplace le logo imprimé.',
    categorySlug: 'polos',
    basePrice: 6400,
    stockPolicy: 'TRACK',
    material: '100 % coton piqué, 220 g/m²',
    careInstructions: 'Lavage 30°, repassage doux',
    embroideryDetails: 'Broderie poitrine gauche, logo jusqu’à 8 cm.',
    isCustomizable: true,
    options: [
      { name: 'Taille', values: SIZES.map((value) => ({ value })) },
      {
        name: 'Couleur',
        values: [
          { value: 'Bleu nuit', hexColor: NAVY },
          { value: 'Écru', hexColor: ECRU },
        ],
      },
    ],
    variants: SIZES.flatMap((size) =>
      [
        { colour: 'Bleu nuit', code: 'BLN' },
        { colour: 'Écru', code: 'ECR' },
      ].map(({ colour, code }) => ({
        options: { Taille: size, Couleur: colour },
        skuSuffix: `${code}-${size}`,
        stockQuantity: 10,
      })),
    ),
    images: [{ alt: 'Polo piqué blanc avec le logo d’un glacier brodé en poitrine' }],
  },
  {
    slug: 'casquette-brodee',
    name: 'Casquette brodée',
    description:
      'Casquette six panneaux, visière préformée, fermeture métal réglable. Taille unique, brodée sur le panneau frontal.',
    categorySlug: 'accessoires',
    basePrice: 3200,
    stockPolicy: 'TRACK',
    material: 'Sergé de coton',
    careInstructions: 'Nettoyage à la main',
    embroideryDetails: 'Broderie frontale, 5 cm de haut maximum.',
    isCustomizable: true,
    isNewArrival: true,
    options: [
      {
        name: 'Couleur',
        values: [
          { value: 'Écru', hexColor: ECRU },
          { value: 'Noir encre', hexColor: INK },
          { value: 'Ocre', hexColor: OCHRE },
        ],
      },
    ],
    variants: [
      { options: { Couleur: 'Écru' }, skuSuffix: 'ECR', stockQuantity: 20 },
      { options: { Couleur: 'Noir encre' }, skuSuffix: 'NOI', stockQuantity: 20 },
      { options: { Couleur: 'Ocre' }, skuSuffix: 'OCR', stockQuantity: 6 },
    ],
    images: [
      { alt: 'Casquette écrue brodée, vue de trois quarts' },
      { alt: 'Détail de la broderie sur le panneau frontal' },
    ],
  },
  {
    slug: 'tote-bag-toile-epaisse',
    name: 'Tote bag toile épaisse',
    description:
      'Toile de coton 340 g/m², anses renforcées de 70 cm, coutures doublées aux points de tension. Se brode particulièrement bien en monogramme.',
    categorySlug: 'accessoires',
    basePrice: 2500,
    // Made to order: always available, never counted.
    stockPolicy: 'MADE_TO_ORDER',
    material: '100 % coton, 340 g/m²',
    careInstructions: 'Lavage 30°',
    embroideryDetails: 'Monogramme ou logo, centré, jusqu’à 20 cm.',
    isCustomizable: true,
    options: [{ name: 'Couleur', values: [{ value: 'Écru', hexColor: ECRU }] }],
    variants: [{ options: { Couleur: 'Écru' }, skuSuffix: 'ECR', stockQuantity: 0 }],
    images: [{ alt: 'Tote bag en toile écrue avec monogramme brodé' }],
  },
  {
    slug: 'bonnet-cotele-brode',
    name: 'Bonnet côtelé brodé',
    description:
      'Maille côtelée double épaisseur, revers cousu. Série saisonnière, brodée en petit format sur le revers.',
    categorySlug: 'accessoires',
    basePrice: 2800,
    stockPolicy: 'TRACK',
    material: 'Acrylique doux, maille côtelée',
    careInstructions: 'Lavage à la main, séchage à plat',
    embroideryDetails: 'Broderie sur le revers, petit format.',
    options: [
      {
        name: 'Couleur',
        values: [
          { value: 'Noir encre', hexColor: INK },
          { value: 'Vert olive', hexColor: OLIVE },
        ],
      },
    ],
    // Every variant out of stock: exercises "visible but not purchasable"
    // (BUSINESS-RULES.md 11.3), which must render rather than 404.
    variants: [
      { options: { Couleur: 'Noir encre' }, skuSuffix: 'NOI', stockQuantity: 0 },
      { options: { Couleur: 'Vert olive' }, skuSuffix: 'OLI', stockQuantity: 0 },
    ],
    images: [{ alt: 'Bonnet côtelé noir avec broderie sur le revers' }],
  },
  {
    slug: 'tablier-atelier-brode',
    name: 'Tablier d’atelier brodé',
    description:
      'Toile de coton épaisse, bavette haute, sangles croisées dans le dos et double poche ventrale. Brodé au nom de l’artisan ou de l’établissement.',
    categorySlug: 'accessoires',
    basePrice: 5400,
    stockPolicy: 'MADE_TO_ORDER',
    material: '100 % coton, 280 g/m²',
    careInstructions: 'Lavage 40°',
    embroideryDetails: 'Broderie bavette, texte ou logo jusqu’à 12 cm.',
    isCustomizable: true,
    options: [{ name: 'Couleur', values: [{ value: 'Écru', hexColor: ECRU }] }],
    variants: [{ options: { Couleur: 'Écru' }, skuSuffix: 'ECR', stockQuantity: 0 }],
    images: [{ alt: 'Tablier d’atelier écru avec broderie sur la bavette' }],
  },
];

/**
 * A product that must NOT reach the storefront.
 *
 * Every visibility rule is easy to write and easy to get subtly wrong, so the
 * seed plants one draft. `BUSINESS-RULES.md` 11.5 keeps drafts admin-only, and
 * a database test asserts this slug never appears in a public query.
 */
const DRAFT_PRODUCT: SeedProduct = {
  slug: 'echantillon-interne-non-publie',
  name: 'Échantillon interne (non publié)',
  description:
    'Produit en brouillon utilisé par les tests de visibilité. Ne doit jamais apparaître dans la boutique.',
  categorySlug: 't-shirts',
  basePrice: 1000,
  stockPolicy: 'DONT_TRACK',
  options: [],
  variants: [],
  images: [],
};

/* ---------------------------------------------------------------------------
 * English
 * ------------------------------------------------------------------------ */

/**
 * The catalogue's English overlay, keyed by slug.
 *
 * Separate from the product definitions above on purpose. French is the source
 * of truth (ADR-040) and the English is a translation *of* it; keeping them in
 * one object would invite the two to be edited as though they were equals, and
 * the first thing to go would be the rule that a missing English field falls
 * back to French rather than blanking it out.
 *
 * Deliberately **not exhaustive**. Two products carry a name and nothing else,
 * because a half-translated catalogue is the normal state of one that is being
 * translated, and it is the state the site has to render correctly. If every
 * row here were complete, the fallback would never be exercised by anything but
 * a test.
 */
const ENGLISH_CATEGORIES: Readonly<
  Record<string, { name: string; description: string }>
> = {
  't-shirts': {
    name: 'T-shirts',
    description: 'Combed cotton, embroidered after making up.',
  },
  sweats: { name: 'Sweatshirts', description: 'Brushed fleece, lined hood.' },
  polos: { name: 'Polo shirts', description: 'Cotton piqué, knitted collar.' },
  accessoires: {
    name: 'Accessories',
    description: 'Caps, beanies and canvas bags.',
  },
};

/**
 * One row's overlay, in the shape the column holds.
 *
 * `Prisma.DbNull` rather than `Prisma.JsonNull`, and the distinction is not
 * academic: a JSON column can hold SQL `NULL` *or* the JSON value `null`, and
 * `JsonNull` writes the second. The check constraint on the column refuses it —
 * `jsonb_typeof('null')` is `'null'`, not `'object'` — which is the constraint
 * doing exactly what it was added for. An untranslated row has no overlay at
 * all, which is `DbNull`.
 */
function englishOverlay(
  english: Readonly<Record<string, string>> | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return english === undefined ? Prisma.DbNull : { en: { ...english } };
}

type EnglishProduct = {
  name: string;
  subtitle?: string;
  description?: string;
  material?: string;
  careInstructions?: string;
  embroideryDetails?: string;
};

const ENGLISH_PRODUCTS: Readonly<Record<string, EnglishProduct>> = {
  't-shirt-brode-classique': {
    name: 'Classic embroidered t-shirt',
    subtitle: 'Straight cut, chest embroidery',
    description:
      'Tightly knitted 180 gsm combed cotton, straight cut, ribbed collar reinforced with a taped seam. The embroidery is worked after making up, on the finished garment, which is what lets it be placed precisely.',
    material: '100% combed cotton, 180 gsm',
    careInstructions: 'Wash at 30°, inside out, do not tumble dry',
    embroideryDetails:
      'Left chest embroidery, high-tenacity polyester thread, up to 3 colours.',
  },
  'sweat-capuche-brode': {
    name: 'Embroidered hooded sweatshirt',
    subtitle: '320 gsm fleece',
    description:
      'Brushed 320 gsm fleece, jersey-lined hood, kangaroo pocket and elastane ribbing at the cuffs. The piece most often asked for in batches.',
    material: '80% cotton, 20% polyester, 320 gsm',
    careInstructions: 'Wash at 30°, inside out, do not tumble dry',
    embroideryDetails: 'Chest or back embroidery, up to 15 cm wide.',
  },
  'polo-pique-brode': {
    name: 'Embroidered piqué polo',
    description:
      '220 gsm cotton piqué, knitted collar and cuffs, three-button placket in mother-of-pearl. The garment of company orders, where embroidery replaces a printed logo.',
    material: '100% piqué cotton, 220 gsm',
    careInstructions: 'Wash at 30°, warm iron',
    embroideryDetails: 'Left chest embroidery, logo up to 8 cm.',
  },
  'casquette-brodee': {
    name: 'Embroidered cap',
    description:
      'Six-panel cap, pre-curved peak, adjustable metal fastening. One size, embroidered on the front panel.',
    material: 'Cotton twill',
    careInstructions: 'Clean by hand',
    embroideryDetails: 'Front embroidery, 5 cm high at most.',
  },
  'tote-bag-toile-epaisse': {
    name: 'Heavy canvas tote bag',
    description:
      '340 gsm cotton canvas, reinforced 70 cm handles, seams doubled at the stress points. Takes a monogram particularly well.',
    material: '100% cotton, 340 gsm',
    careInstructions: 'Wash at 30°',
    embroideryDetails: 'Monogram or logo, centred, up to 20 cm.',
  },
  // Name only, deliberately: the fallback has to be exercised by the seeded
  // catalogue and not only by a test fixture.
  'bonnet-cotele-brode': { name: 'Embroidered ribbed beanie' },
  'tablier-atelier-brode': { name: 'Embroidered workshop apron' },
};

async function seedCatalogue(): Promise<{
  categories: number;
  products: number;
  models: number;
}> {
  const categoryIdBySlug = new Map<string, string>();

  for (const category of CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { slug: category.slug, deletedAt: null },
      select: { id: true },
    });

    const row = existing
      ? await prisma.category.update({
          where: { id: existing.id },
          data: {
            name: category.name,
            description: category.description,
            position: category.position,
            isActive: true,
            translations: englishOverlay(ENGLISH_CATEGORIES[category.slug]),
          },
          select: { id: true },
        })
      : await prisma.category.create({
          data: {
            slug: category.slug,
            name: category.name,
            description: category.description,
            position: category.position,
            translations: englishOverlay(ENGLISH_CATEGORIES[category.slug]),
          },
          select: { id: true },
        });

    categoryIdBySlug.set(category.slug, row.id);
  }

  for (const product of [...PRODUCTS, DRAFT_PRODUCT]) {
    const categoryId = categoryIdBySlug.get(product.categorySlug);
    if (!categoryId) throw new Error(`Unknown category: ${product.categorySlug}`);

    const isDraft = product.slug === DRAFT_PRODUCT.slug;

    const base = {
      name: product.name,
      translations: englishOverlay(ENGLISH_PRODUCTS[product.slug]),
      subtitle: product.subtitle ?? null,
      description: product.description,
      categoryId,
      // A fixed timestamp keeps the seed deterministic: re-running must not
      // reshuffle the listing, which is ordered by publishedAt.
      status: isDraft ? ('DRAFT' as const) : ('ACTIVE' as const),
      publishedAt: isDraft
        ? null
        : new Date(
            product.isFeatured ? '2026-01-02T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
          ),
      basePrice: product.basePrice,
      compareAtPrice: product.compareAtPrice ?? null,
      stockPolicy: product.stockPolicy,
      material: product.material ?? null,
      careInstructions: product.careInstructions ?? null,
      embroideryDetails: product.embroideryDetails ?? null,
      isCustomizable: product.isCustomizable ?? false,
      isFeatured: product.isFeatured ?? false,
      isNewArrival: product.isNewArrival ?? false,
      isBestSeller: product.isBestSeller ?? false,
      seoTitle: null,
      seoDescription: null,
    };

    const existing = await prisma.product.findFirst({
      where: { slug: product.slug, deletedAt: null },
      select: { id: true },
    });

    const productId = existing
      ? (
          await prisma.product.update({
            where: { id: existing.id },
            data: base,
            select: { id: true },
          })
        ).id
      : (
          await prisma.product.create({
            data: { slug: product.slug, ...base },
            select: { id: true },
          })
        ).id;

    // Options and their values.
    const optionValueId = new Map<string, string>();

    for (const [position, option] of product.options.entries()) {
      const optionRow = await prisma.productOption.upsert({
        where: { productId_name: { productId, name: option.name } },
        create: { productId, name: option.name, position },
        update: { position },
        select: { id: true },
      });

      for (const [valuePosition, value] of option.values.entries()) {
        const valueRow = await prisma.productOptionValue.upsert({
          where: { optionId_value: { optionId: optionRow.id, value: value.value } },
          create: {
            optionId: optionRow.id,
            value: value.value,
            hexColor: value.hexColor ?? null,
            position: valuePosition,
          },
          update: { hexColor: value.hexColor ?? null, position: valuePosition },
          select: { id: true },
        });

        optionValueId.set(`${option.name}:${value.value}`, valueRow.id);
      }
    }

    // Variants, keyed on SKU.
    const skuPrefix = product.slug.slice(0, 12).toUpperCase().replace(/-/g, '');

    for (const [position, variant] of product.variants.entries()) {
      const sku = `${skuPrefix}-${variant.skuSuffix}`;

      const variantRow = await prisma.productVariant.upsert({
        where: { sku },
        create: {
          productId,
          sku,
          priceOverride: variant.priceOverride ?? null,
          stockQuantity: variant.stockQuantity ?? 0,
          isActive: variant.isActive ?? true,
          position,
        },
        update: {
          priceOverride: variant.priceOverride ?? null,
          stockQuantity: variant.stockQuantity ?? 0,
          isActive: variant.isActive ?? true,
          position,
        },
        select: { id: true },
      });

      for (const [optionName, value] of Object.entries(variant.options)) {
        const valueId = optionValueId.get(`${optionName}:${value}`);
        if (!valueId) throw new Error(`Unknown option value: ${optionName}=${value}`);

        await prisma.productVariantOptionValue.upsert({
          where: {
            variantId_optionValueId: { variantId: variantRow.id, optionValueId: valueId },
          },
          create: { variantId: variantRow.id, optionValueId: valueId },
          update: {},
        });
      }
    }

    // Images. Keyed on (product, position) via a find-then-write, because the
    // schema has no unique constraint there — position is an ordering, not an
    // identity, and adding one would be a schema change for the seed's benefit.
    /*
     * Has the owner uploaded their own photography for this blank?
     *
     * The seed's pictures live in `public/assets` and its measurements are
     * placeholders; both are worth having on an empty database, and neither is
     * worth having *over the top of* something somebody uploaded and measured
     * through the admin. Because these rows are keyed on (product, position), a
     * re-seed would otherwise overwrite the storage key of a real upload that
     * happens to sit at position 0 — which is exactly what it did once.
     */
    const ownerHasSurfaces =
      (await prisma.productImage.count({
        where: { productId, storageKey: { startsWith: 'media/' } },
      })) > 0;

    if (ownerHasSurfaces) continue;

    for (const [position, image] of product.images.entries()) {
      const storageKey = `products/${product.slug}/${position + 1}.jpg`;
      const pixels = await imageSize(storageKey);

      const existingImage = await prisma.productImage.findFirst({
        where: { productId, position },
        select: { id: true },
      });

      const data = {
        storageKey,
        alt: image.alt,
        position,
        isPrimary: position === 0,
        width: pixels.width,
        height: pixels.height,
        /*
         * A face, when the picture is one and the garment has been measured.
         *
         * Both or neither: a face with no measurement cannot be ordered from,
         * and a measurement on a picture nobody places designs on is data that
         * looks meant (ADR-035).
         */
        ...(image.surface && product.surfaceWidthMm
          ? { surface: image.surface, surfaceWidthMm: product.surfaceWidthMm }
          : { surface: null, surfaceWidthMm: null }),
      };

      if (existingImage) {
        await prisma.productImage.update({ where: { id: existingImage.id }, data });
      } else {
        await prisma.productImage.create({ data: { productId, ...data } });
      }
    }
  }

  const models = await seedDemoModel();

  return { categories: CATEGORIES.length, products: PRODUCTS.length + 1, models };
}

/**
 * The demo garment model, attached to the t-shirt.
 *
 * `scripts/make-demo-model.ts` writes the file; this points a row at it. Both
 * halves are deliberate: the parser, the storage prefix and the texture
 * transform all shipped in Phase 14.10 with nothing to exercise them, and a
 * pipeline with no data in it is a pipeline nobody can tell is broken.
 *
 * It is **skipped when the file is not there**, so a checkout that has not run
 * the generator seeds cleanly rather than advertising a model that 404s. And it
 * is skipped when the product already has a model, for the same reason the
 * photography is: the owner's real model must survive `npm run db:seed`.
 */
async function seedDemoModel(): Promise<number> {
  const file = join(process.cwd(), 'public', 'assets', DEMO_MODEL_KEY);

  if (!existsSync(file)) return 0;

  const product = await prisma.product.findFirst({
    where: { slug: DEMO_MODEL_PRODUCT_SLUG, deletedAt: null },
    select: { id: true, models3d: { select: { id: true } } },
  });

  if (!product || product.models3d.length > 0) return 0;

  await prisma.productModel3d.create({
    data: {
      productId: product.id,
      storageKey: DEMO_MODEL_KEY,
      byteSize: statSync(file).size,
      materialName: DEMO_MODEL_MATERIAL,
      /*
       * The same measurement the photographs carry, so the millimetres the
       * builder quotes do not change when the customer switches to the 3D
       * view. ADR-035: the transform is shared; the scale has to be too.
       */
      surfaceWidthMm: 620,
      label: 'Modèle de démonstration',
    },
  });

  return 1;
}

/**
 * A seeded picture's real pixel dimensions, read from the file.
 *
 * They used to be hard-coded at 1200 × 1500 for every image, which was wrong
 * for every image and harmless only because nothing read them. The placement
 * editor reads them twice — for the shape of the canvas, and to decide whether
 * a tall design runs off the hem (`fitsWithin`) — so a guess here is a design
 * approved in the wrong place.
 *
 * A missing file falls back rather than throwing: a developer who has not
 * checked out the binary assets should still get a working catalogue.
 */
async function imageSize(storageKey: string): Promise<{ width: number; height: number }> {
  try {
    const file = join(process.cwd(), 'public', 'assets', storageKey);
    const { width, height } = await sharp(file).metadata();

    if (width && height) return { width, height };
  } catch {
    // Falls through to the default below.
  }

  return { width: 1200, height: 1500 };
}

// ---------------------------------------------------------------------------
// Embroidery reference data (DATABASE.md section 19)
//
// Placements, embroidery sizes, thread colours, fonts and the default
// customisation profile. The builder cannot exist without these rows, which is
// why they arrive with it.
//
// **The prices here are structurally correct placeholders**, in the same sense
// as the Phase 2 shipping rates: the shape, the units and the relationships are
// right, but the amounts are the owner's to set before launch. They are listed
// as an open decision in tasks/CURRENT.md rather than presented as real
// business pricing. Every one is an integer of minor units (ADR-012).
//
// Diagram assets (`diagramImageKey`) are deliberately null: UX.md section 5
// asks for a garment silhouette per placement, and those illustrations do not
// exist. The builder renders the placement name and its size limits instead,
// which is honest rather than a broken image.
// ---------------------------------------------------------------------------

const PLACEMENTS: ReadonlyArray<{
  code: string;
  name: string;
  description: string;
  maxWidthMm: number;
  maxHeightMm: number;
  position: number;
}> = [
  {
    code: 'LEFT_CHEST',
    name: 'Poitrine gauche',
    description: 'L’emplacement classique pour un logo ou un monogramme.',
    maxWidthMm: 100,
    maxHeightMm: 100,
    position: 1,
  },
  {
    code: 'RIGHT_CHEST',
    name: 'Poitrine droite',
    description: 'Symétrique du précédent.',
    maxWidthMm: 100,
    maxHeightMm: 100,
    position: 2,
  },
  {
    code: 'CENTER_CHEST',
    name: 'Centre poitrine',
    description: 'Plus visible, pour un motif large.',
    maxWidthMm: 200,
    maxHeightMm: 200,
    position: 3,
  },
  {
    code: 'BACK',
    name: 'Dos',
    description: 'La plus grande surface disponible.',
    maxWidthMm: 300,
    maxHeightMm: 300,
    position: 4,
  },
  {
    code: 'SLEEVE',
    name: 'Manche',
    description: 'Format étroit, sur la manche gauche ou droite.',
    maxWidthMm: 80,
    maxHeightMm: 60,
    position: 5,
  },
  {
    code: 'CAP_FRONT',
    name: 'Panneau frontal',
    description: 'Pour les casquettes et les bonnets.',
    maxWidthMm: 120,
    maxHeightMm: 50,
    position: 6,
  },
];

const EMBROIDERY_SIZES: ReadonlyArray<{
  code: string;
  name: string;
  description: string;
  maxWidthMm: number;
  maxHeightMm: number;
  basePrice: number;
  position: number;
}> = [
  {
    code: 'SMALL',
    name: 'Petite',
    description: 'Jusqu’à 60 × 60 mm — monogramme, petit logo.',
    maxWidthMm: 60,
    maxHeightMm: 60,
    basePrice: 800,
    position: 1,
  },
  {
    code: 'MEDIUM',
    name: 'Moyenne',
    description: 'Jusqu’à 120 × 120 mm — logo d’entreprise standard.',
    maxWidthMm: 120,
    maxHeightMm: 120,
    basePrice: 1400,
    position: 2,
  },
  {
    code: 'LARGE',
    name: 'Grande',
    description: 'Jusqu’à 250 × 250 mm — motif dos ou grande poitrine.',
    maxWidthMm: 250,
    maxHeightMm: 250,
    basePrice: 2600,
    position: 3,
  },
];

/** A working palette. The owner's real thread stock replaces it before launch. */
const THREAD_COLORS: ReadonlyArray<[code: string, name: string, hex: string]> = [
  ['BLANC', 'Blanc', '#ffffff'],
  ['ECRU', 'Écru', '#f1e9dc'],
  ['NOIR', 'Noir', '#12100e'],
  ['GRIS', 'Gris acier', '#7a7268'],
  ['ROUGE', 'Rouge', '#9b2c22'],
  ['BORDEAUX', 'Bordeaux', '#5e2029'],
  ['OCRE', 'Ocre', '#9a4e26'],
  ['MOUTARDE', 'Moutarde', '#b58a1b'],
  ['VERT', 'Vert forêt', '#1f5b3f'],
  ['OLIVE', 'Olive', '#5a6340'],
  ['BLEU', 'Bleu nuit', '#2b4a6f'],
  ['CIEL', 'Bleu ciel', '#7ea6d6'],
  ['OR', 'Or', '#b08d3f'],
  ['ARGENT', 'Argent', '#a9adb2'],
];

const FONTS: ReadonlyArray<[name: string, cssFontFamily: string, position: number]> = [
  ['Serif classique', 'Georgia, serif', 1],
  ['Sans moderne', 'system-ui, sans-serif', 2],
  ['Script', 'cursive', 3],
];

const PROFILE_NAME = 'Profil de broderie standard';

async function seedEmbroideryReference(): Promise<{
  placements: number;
  sizes: number;
  threadColors: number;
}> {
  for (const placement of PLACEMENTS) {
    await prisma.placement.upsert({
      where: { code: placement.code },
      create: { ...placement, diagramImageKey: null },
      update: {
        name: placement.name,
        description: placement.description,
        maxWidthMm: placement.maxWidthMm,
        maxHeightMm: placement.maxHeightMm,
        position: placement.position,
        isActive: true,
      },
    });
  }

  for (const size of EMBROIDERY_SIZES) {
    await prisma.embroiderySize.upsert({
      where: { code: size.code },
      create: size,
      update: { ...size, isActive: true },
    });
  }

  for (const [position, [code, name, hexColor]] of THREAD_COLORS.entries()) {
    await prisma.threadColor.upsert({
      where: { code },
      create: { code, name, hexColor, position },
      update: { name, hexColor, position, isActive: true },
    });
  }

  for (const [name, cssFontFamily, position] of FONTS) {
    const existing = await prisma.embroideryFont.findFirst({
      where: { name },
      select: { id: true },
    });

    if (existing) {
      await prisma.embroideryFont.update({
        where: { id: existing.id },
        data: { cssFontFamily, position, isActive: true },
      });
    } else {
      await prisma.embroideryFont.create({ data: { name, cssFontFamily, position } });
    }
  }

  // The default profile: which placements and sizes a product may use, and
  // what each placement adds to the price. `priceModifier` is a placeholder in
  // the same sense as the base prices above.
  const existingProfile = await prisma.customizationProfile.findFirst({
    where: { name: PROFILE_NAME },
    select: { id: true },
  });

  const profileId = existingProfile
    ? existingProfile.id
    : (
        await prisma.customizationProfile.create({
          data: {
            name: PROFILE_NAME,
            description:
              'Emplacements et tailles disponibles par défaut. Valeurs de démonstration.',
            isDefault: true,
          },
          select: { id: true },
        })
      ).id;

  const placementModifiers: Record<string, number> = {
    LEFT_CHEST: 0,
    RIGHT_CHEST: 0,
    CENTER_CHEST: 200,
    // The largest surface, and the slowest to run.
    BACK: 600,
    SLEEVE: 100,
    CAP_FRONT: 0,
  };

  for (const [position, placement] of PLACEMENTS.entries()) {
    const row = await prisma.placement.findUniqueOrThrow({
      where: { code: placement.code },
      select: { id: true },
    });

    await prisma.profilePlacement.upsert({
      where: { profileId_placementId: { profileId, placementId: row.id } },
      create: {
        profileId,
        placementId: row.id,
        priceModifier: placementModifiers[placement.code] ?? 0,
        position,
      },
      update: {
        priceModifier: placementModifiers[placement.code] ?? 0,
        position,
      },
    });
  }

  for (const [position, size] of EMBROIDERY_SIZES.entries()) {
    const row = await prisma.embroiderySize.findUniqueOrThrow({
      where: { code: size.code },
      select: { id: true },
    });

    await prisma.profileEmbroiderySize.upsert({
      where: { profileId_embroiderySizeId: { profileId, embroiderySizeId: row.id } },
      create: { profileId, embroiderySizeId: row.id, priceModifier: 0, position },
      update: { priceModifier: 0, position },
    });
  }

  // Attach the profile to every customisable product, so the builder has
  // placements and sizes to offer for each of them.
  await prisma.product.updateMany({
    where: { isCustomizable: true, customizationProfileId: null },
    data: { customizationProfileId: profileId },
  });

  return {
    placements: PLACEMENTS.length,
    sizes: EMBROIDERY_SIZES.length,
    threadColors: THREAD_COLORS.length,
  };
}

// ---------------------------------------------------------------------------
// Storefront content — DATABASE.md section 13, ROADMAP.md Phase 13.
//
// The homepage is a list of `homepage_sections` rows ordered by `position`,
// and this is where the copy that used to be hard-coded in the page component
// now lives. Reordering the front page is an UPDATE, which is what the roadmap
// means by "reorderable".
//
// Two deliberate absences:
//
//   - **no reviews.** A review is a customer's statement, and seeding one would
//     be fabricating social proof — exactly what the homepage has refused since
//     Phase 5. The `REVIEWS` band renders nothing until a real review is
//     approved, which is the honest state of a shop nobody has reviewed yet.
//   - **no social links.** A seeded profile URL is an account that does not
//     exist. The `SOCIAL` band is enabled and renders nothing until the owner
//     adds a row.
//
// The gallery items are demo data in the same sense as the demo products, and
// their `imageKey` points at the path a photograph *will* occupy — until the
// public bucket exists, the media primitives render their placeholder, which is
// why the alt text is written properly here.
// ---------------------------------------------------------------------------

const TAGS: ReadonlyArray<{ slug: string; name: string }> = [
  { slug: 't-shirt', name: 'T-shirt' },
  { slug: 'sweat', name: 'Sweat' },
  { slug: 'polo', name: 'Polo' },
  { slug: 'casquette', name: 'Casquette' },
  { slug: 'tote-bag', name: 'Tote bag' },
  { slug: 'tablier', name: 'Tablier' },
];

/** Which tags each seeded product carries, so the gallery can link to it. */
const PRODUCT_TAGS: Readonly<Record<string, readonly string[]>> = {
  't-shirt-brode-classique': ['t-shirt'],
  'sweat-capuche-brode': ['sweat'],
  'polo-pique-brode': ['polo'],
  'casquette-brodee': ['casquette'],
  'tote-bag-toile-epaisse': ['tote-bag'],
  'tablier-atelier-brode': ['tablier'],
};

type SeedGalleryItem = {
  slug: string;
  title: string;
  description: string;
  alt: string;
  productType: string;
  embroideryType: string;
  position: number;
  isFeatured: boolean;
  tags: readonly string[];
};

const GALLERY_ITEMS: readonly SeedGalleryItem[] = [
  {
    slug: 'logo-glacier-polo',
    title: 'Logo d’un glacier sur polo',
    description:
      'Le logo de Casa Glace, glacier artisanal, brodé en couleurs sur la poitrine d’un polo piqué blanc.',
    alt: 'Polo blanc avec le logo rond et coloré d’un glacier brodé en poitrine',
    productType: 'Polo',
    embroideryType: 'Logo d’entreprise',
    position: 1,
    isFeatured: true,
    tags: ['polo'],
  },
  {
    slug: 'obito-uchiha-sweat-blanc',
    title: 'Obito Uchiha sur un sweat blanc',
    description:
      'Le personnage du manga Naruto, brodé en grand format et en plusieurs couleurs sur le devant d’un sweat à capuche blanc.',
    alt: 'Sweat blanc avec un grand portrait brodé d’Obito Uchiha',
    productType: 'Sweat',
    embroideryType: 'Motif',
    position: 2,
    isFeatured: true,
    tags: ['sweat'],
  },
  {
    slug: 'calligraphie-arabe-sweat-noir',
    title: 'Calligraphie arabe sur un sweat noir',
    description:
      'Une calligraphie arabe sur mesure, brodée en fil blanc sur un sweat à capuche noir.',
    alt: 'Sweat noir plié avec une calligraphie arabe brodée en blanc',
    productType: 'Sweat',
    embroideryType: 'Texte',
    position: 3,
    isFeatured: true,
    tags: ['sweat'],
  },
  {
    slug: 'cadeau-couple-chiffres-romains',
    title: 'Un cadeau pour un couple',
    description:
      'Une date en chiffres romains et un symbole de l’infini, brodés en noir sur un sweat à capuche blanc offert en cadeau.',
    alt: 'Sweat blanc portant une date en chiffres romains et un symbole de l’infini brodés en noir',
    productType: 'Sweat',
    embroideryType: 'Date',
    position: 4,
    isFeatured: true,
    tags: ['sweat'],
  },
  {
    slug: 'logos-kiffan-pub-t-shirts',
    title: 'Le logo d’une entreprise sur des t-shirts',
    description:
      'Le logo et les coordonnées de Kiffan Pub, brodés sur une série de t-shirts bleus et noirs.',
    alt: 'T-shirts bleus et noirs posés à plat, avec le logo Kiffan Pub brodé',
    productType: 'T-shirt',
    embroideryType: 'Logo d’entreprise',
    position: 5,
    isFeatured: false,
    tags: ['t-shirt'],
  },
  {
    slug: 'iowa-sweat-noir',
    title: 'IOWA en grandes lettres',
    description:
      'Le mot IOWA brodé en lettres blanches sur tout le dos d’un sweat à capuche noir.',
    alt: 'Dos d’un sweat noir avec IOWA brodé en grandes lettres blanches',
    productType: 'Sweat',
    embroideryType: 'Texte',
    position: 6,
    isFeatured: false,
    tags: ['sweat'],
  },
];

/** A statement of fact about how delivery works, not a marketing claim. */
const BANNERS: ReadonlyArray<{
  message: string;
  href: string | null;
  position: number;
}> = [
  {
    message:
      'Livraison dans les 58 wilayas — le tarif de votre zone s’affiche au paiement.',
    href: null,
    position: 1,
  },
];

async function seedContent(): Promise<{
  tags: number;
  gallery: number;
  sections: number;
  banners: number;
}> {
  for (const tag of TAGS) {
    await prisma.tag.upsert({
      where: { slug: tag.slug },
      update: { name: tag.name },
      create: { slug: tag.slug, name: tag.name },
    });
  }

  const tagIds = new Map<string, string>();
  for (const tag of await prisma.tag.findMany({ select: { id: true, slug: true } })) {
    tagIds.set(tag.slug, tag.id);
  }

  // Products carry the same tags the gallery items do, which is what makes
  // "related products" on a gallery page a real join rather than a guess.
  for (const [productSlug, slugs] of Object.entries(PRODUCT_TAGS)) {
    const product = await prisma.product.findFirst({
      where: { slug: productSlug },
      select: { id: true },
    });

    if (!product) continue;

    for (const slug of slugs) {
      const tagId = tagIds.get(slug);
      if (!tagId) continue;

      await prisma.productTag.upsert({
        where: { productId_tagId: { productId: product.id, tagId } },
        update: {},
        create: { productId: product.id, tagId },
      });
    }
  }

  for (const item of GALLERY_ITEMS) {
    const saved = await prisma.galleryItem.upsert({
      where: { slug: item.slug },
      update: {
        title: item.title,
        description: item.description,
        alt: item.alt,
        productType: item.productType,
        embroideryType: item.embroideryType,
        position: item.position,
        isFeatured: item.isFeatured,
        isPublished: true,
      },
      create: {
        slug: item.slug,
        title: item.title,
        description: item.description,
        // The path a photograph will occupy in the public bucket.
        imageKey: `gallery/${item.slug}.jpg`,
        alt: item.alt,
        productType: item.productType,
        embroideryType: item.embroideryType,
        position: item.position,
        isFeatured: item.isFeatured,
        isPublished: true,
      },
      select: { id: true },
    });

    for (const slug of item.tags) {
      const tagId = tagIds.get(slug);
      if (!tagId) continue;

      await prisma.galleryTag.upsert({
        where: { galleryItemId_tagId: { galleryItemId: saved.id, tagId } },
        update: {},
        create: { galleryItemId: saved.id, tagId },
      });
    }
  }

  // Sections have no natural key beyond their type: one band of each kind is
  // what V1 has, so the type is the key and re-running converges.
  for (const section of HOMEPAGE_SECTIONS) {
    const existing = await prisma.homepageSection.findFirst({
      where: { type: section.type },
      select: { id: true },
    });

    const data = {
      type: section.type,
      position: section.position,
      isEnabled: section.isEnabled,
      title: section.title ?? null,
      subtitle: section.subtitle ?? null,
      body: section.body ?? null,
      ctaLabel: section.ctaLabel ?? null,
      ctaHref: section.ctaHref ?? null,
      config: section.config ?? Prisma.DbNull,
    };

    if (existing) {
      await prisma.homepageSection.update({ where: { id: existing.id }, data });
    } else {
      await prisma.homepageSection.create({ data });
    }
  }

  for (const banner of BANNERS) {
    const existing = await prisma.banner.findFirst({
      where: { message: banner.message },
      select: { id: true },
    });

    if (!existing) {
      await prisma.banner.create({
        data: {
          message: banner.message,
          href: banner.href,
          position: banner.position,
          isActive: true,
        },
      });
    }
  }

  return {
    tags: TAGS.length,
    gallery: GALLERY_ITEMS.length,
    sections: HOMEPAGE_SECTIONS.length,
    banners: BANNERS.length,
  };
}

async function main(): Promise<void> {
  console.info('Seeding Bizeora reference data...');

  const wilayas = await seedWilayas();
  console.info(`  wilayas          ${wilayas}`);

  const zones = await seedShipping();
  console.info(`  shipping zones   ${zones} (placeholder rates)`);

  const tiers = await seedDiscountTiers();
  console.info(`  discount tiers   ${tiers}`);

  const settings = await seedSettings();
  console.info(`  settings         ${settings}`);

  const catalogue = await seedCatalogue();
  console.info(
    `  categories       ${catalogue.categories}
  products         ${catalogue.products} (demo, incl. 1 draft)
  3D models        ${catalogue.models}`,
  );

  const embroidery = await seedEmbroideryReference();
  console.info(
    `  placements       ${embroidery.placements} (placeholder prices)
  embroidery sizes ${embroidery.sizes}
  thread colours   ${embroidery.threadColors}`,
  );

  const content = await seedContent();
  console.info(
    `  gallery items    ${content.gallery} (demo)
  homepage bands   ${content.sections}
  tags             ${content.tags}
  banners          ${content.banners}`,
  );

  console.info('Seed complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
