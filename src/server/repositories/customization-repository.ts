import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/client';
import type { NotificationTx } from '@/server/repositories/notification-repository';
import { toPublicAssetUrl } from '@/lib/media/public-asset';
import { isProductPurchasable } from '@/domain/order/availability';
import { resolveUnitPrice } from '@/domain/pricing';
import type { CustomizationRates } from '@/domain/pricing/customization';
import type { PricingModeThresholds } from '@/domain/customization/pricing-mode';
import type { DiscountTier } from '@/domain/discount';
import type { ConfigurationLimits } from '@/domain/customization/validation';
import type { DesignSurface } from '@/domain/customization/placement';

/**
 * Everything the custom builder reads.
 *
 * Alongside the catalogue repository, one of two Prisma consumers outside
 * `lib/db`. Same rules: explicit `select`, DTOs out, business rules imported
 * rather than reimplemented.
 *
 * The settings this loads are the ones `BUSINESS-RULES.md` insists must not be
 * hard-coded — the quote thresholds, the estimate band, the surcharge rates.
 * They are read once per request and handed to the domain functions.
 */

/* ---------------------------------------------------------------------------
 * DTOs
 * ------------------------------------------------------------------------ */

export type BuilderProduct = {
  slug: string;
  name: string;
  category: string;
  /** Cheapest purchasable unit price — the "from X DA" on a product card. */
  fromPrice: number;
  currency: string;
  image: { src: string | null; alt: string } | null;
  /** The faces a design may be placed on. Empty until the owner names one. */
  surfaces: readonly BuilderSurface[];
  /** The garment in the round, when a `.glb` has been uploaded and measured. */
  model: BuilderModel | null;
  colours: readonly { name: string; hex: string | null }[];
  variants: readonly {
    sku: string;
    options: Readonly<Record<string, string>>;
    price: number;
    available: boolean;
  }[];
  options: readonly { name: string; values: readonly string[] }[];
  available: boolean;
};

/**
 * A face of the blank the customer can drop a design onto.
 *
 * A photograph that the owner has named and measured (ADR-035). The pixel
 * dimensions travel with it because the editor needs the picture's own aspect
 * ratio to know what a percentage down it is worth against a percentage across
 * it — without them a portrait logo on a portrait garment reads as fitting when
 * it runs off the hem.
 */
export type BuilderSurface = {
  imageId: string;
  surface: DesignSurface;
  src: string | null;
  alt: string;
  widthPx: number | null;
  heightPx: number | null;
  /** How wide the garment really is across this picture. */
  widthMm: number;
};

/**
 * The garment modelled in the round, when one has been uploaded.
 *
 * Optional everywhere. A blank with photographs and no model gets the flat
 * editor; a blank with both gets the one that spins. The transform the customer
 * produces is identical either way, because it was never expressed in a
 * photograph's pixels.
 */
export type BuilderModel = {
  id: string;
  src: string | null;
  materialName: string;
  widthMm: number;
};

export type BuilderPlacement = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  maxWidthMm: number | null;
  maxHeightMm: number | null;
  /** From the product's profile. Added to the unit price by `domain/pricing`. */
  priceModifier: number;
};

export type BuilderEmbroiderySize = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  maxWidthMm: number | null;
  maxHeightMm: number | null;
  basePrice: number;
};

export type BuilderThreadColor = { id: string; name: string; hexColor: string };

export type BuilderSettings = PricingModeThresholds &
  CustomizationRates & {
    /** `custom_orders.responseTimeHours`. Shown, never used in a calculation. */
    responseTimeHours: number;
    limits: ConfigurationLimits;
  };

export type BuilderReferenceData = {
  placements: readonly BuilderPlacement[];
  embroiderySizes: readonly BuilderEmbroiderySize[];
  threadColors: readonly BuilderThreadColor[];
  discountTiers: readonly DiscountTier[];
  settings: BuilderSettings;
};

/* ---------------------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------------------ */

const REQUIRED_SETTINGS = [
  'custom_orders.quoteThresholdThreadColors',
  'custom_orders.quoteThresholdQuantity',
  'custom_orders.quoteThresholdInstructionLength',
  'custom_orders.maxThreadColors',
  'custom_orders.estimateBandPercent',
  'custom_orders.threadColorSurchargePerColor',
  'custom_orders.textSurcharge',
  'custom_orders.setupFee',
  'custom_orders.setupFeeWaiverQuantity',
  'custom_orders.responseTimeHours',
] as const;

/**
 * Load the pricing and threshold settings.
 *
 * Throws when one is missing rather than substituting a default. Every value
 * here participates in a price or in the fixed-versus-quote decision, and a
 * silent fallback would mean the builder quoting a number the business never
 * agreed to. `DATABASE.md` section 14 seeds all of them.
 */
export async function loadBuilderSettings(): Promise<BuilderSettings> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...REQUIRED_SETTINGS] } },
    select: { key: true, value: true },
  });

  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  function number(key: (typeof REQUIRED_SETTINGS)[number]): number {
    const raw = byKey.get(key);
    const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);

    if (!Number.isFinite(parsed)) {
      throw new Error(`Setting ${key} is missing or not an integer. Run the seed.`);
    }
    return parsed;
  }

  return {
    quoteThresholdThreadColors: number('custom_orders.quoteThresholdThreadColors'),
    quoteThresholdQuantity: number('custom_orders.quoteThresholdQuantity'),
    quoteThresholdInstructionLength: number(
      'custom_orders.quoteThresholdInstructionLength',
    ),
    estimateBandBasisPoints: number('custom_orders.estimateBandPercent'),
    threadColorSurchargePerColor: number('custom_orders.threadColorSurchargePerColor'),
    textSurcharge: number('custom_orders.textSurcharge'),
    setupFee: number('custom_orders.setupFee'),
    setupFeeWaiverQuantity: number('custom_orders.setupFeeWaiverQuantity'),
    responseTimeHours: number('custom_orders.responseTimeHours'),
    limits: {
      maxThreadColors: number('custom_orders.maxThreadColors'),
      maxQuantity: 1000,
      maxInstructionsLength: 2000,
      maxEmbroideryTextLength: 60,
    },
  };
}

/* ---------------------------------------------------------------------------
 * Products
 * ------------------------------------------------------------------------ */

const BUILDER_PRODUCT_SELECT = {
  slug: true,
  name: true,
  basePrice: true,
  currency: true,
  stockPolicy: true,
  category: { select: { name: true } },
  images: {
    select: {
      id: true,
      storageKey: true,
      alt: true,
      width: true,
      height: true,
      surface: true,
      surfaceWidthMm: true,
      isPrimary: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }],
  },
  models3d: {
    where: { isActive: true },
    select: {
      id: true,
      storageKey: true,
      materialName: true,
      surfaceWidthMm: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 1,
  },
  options: {
    select: {
      name: true,
      values: { select: { value: true, hexColor: true }, orderBy: { position: 'asc' } },
    },
    orderBy: { position: 'asc' },
  },
  variants: {
    select: {
      sku: true,
      priceOverride: true,
      isActive: true,
      stockQuantity: true,
      reservedQuantity: true,
      optionValues: {
        select: {
          optionValue: {
            select: { value: true, option: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.ProductSelect;

type BuilderProductRow = Prisma.ProductGetPayload<{
  select: typeof BUILDER_PRODUCT_SELECT;
}>;

function toBuilderProduct(row: BuilderProductRow): BuilderProduct {
  const policy = row.stockPolicy as 'TRACK' | 'DONT_TRACK' | 'MADE_TO_ORDER';
  const product = { basePrice: row.basePrice, compareAtPrice: null };

  const variants = row.variants.map((variant) => ({
    sku: variant.sku,
    options: Object.fromEntries(
      variant.optionValues.map((link) => [
        link.optionValue.option.name,
        link.optionValue.value,
      ]),
    ),
    price: resolveUnitPrice(product, { ...variant, compareAtPriceOverride: null }),
    available: variant.isActive && isProductPurchasable([variant], policy),
  }));

  const availablePrices = variants
    .filter((variant) => variant.available)
    .map((variant) => variant.price);

  return {
    slug: row.slug,
    name: row.name,
    category: row.category.name,
    // "from X DA" — the cheapest thing the customer could actually buy.
    fromPrice: availablePrices.length > 0 ? Math.min(...availablePrices) : row.basePrice,
    currency: row.currency,
    image: row.images[0]
      ? { src: toPublicAssetUrl(row.images[0].storageKey), alt: row.images[0].alt }
      : null,
    /*
     * Only the faces that are ready to be placed on.
     *
     * A picture needs both a face and a measurement to be usable, so a
     * half-configured one is filtered out here rather than reaching the editor
     * and failing there. `WRAP` is excluded too: it belongs to the 3D model,
     * which is carried separately, and a photograph should never claim it.
     */
    surfaces: row.images
      .filter(
        (image) =>
          image.surface !== null && image.surface !== 'WRAP' && image.surfaceWidthMm,
      )
      .map((image) => ({
        imageId: image.id,
        surface: image.surface as DesignSurface,
        src: toPublicAssetUrl(image.storageKey),
        alt: image.alt,
        widthPx: image.width,
        heightPx: image.height,
        widthMm: image.surfaceWidthMm as number,
      })),
    model:
      row.models3d[0] && row.models3d[0].surfaceWidthMm
        ? {
            id: row.models3d[0].id,
            src: toPublicAssetUrl(row.models3d[0].storageKey),
            materialName: row.models3d[0].materialName,
            widthMm: row.models3d[0].surfaceWidthMm,
          }
        : null,
    colours:
      row.options
        .find((option) => option.name.toLowerCase() === 'couleur')
        ?.values.map((value) => ({ name: value.value, hex: value.hexColor })) ?? [],
    variants,
    options: row.options.map((option) => ({
      name: option.name,
      values: option.values.map((value) => value.value),
    })),
    available: isProductPurchasable(
      row.variants.map((variant) => ({
        isActive: variant.isActive,
        stockQuantity: variant.stockQuantity,
        reservedQuantity: variant.reservedQuantity,
      })),
      policy,
    ),
  };
}

/**
 * The blanks a customer may embroider.
 *
 * `isCustomizable` is the gate, on top of the same public-visibility predicate
 * the catalogue uses. Filtering happens in the query: a product the business
 * has not marked customisable must never reach step 1.
 */
export async function listCustomizableProducts(): Promise<readonly BuilderProduct[]> {
  const rows = await prisma.product.findMany({
    where: {
      isCustomizable: true,
      status: 'ACTIVE',
      deletedAt: null,
      publishedAt: { not: null, lte: new Date() },
    },
    select: BUILDER_PRODUCT_SELECT,
    orderBy: [{ basePrice: 'asc' }, { id: 'asc' }],
    take: 48,
  });

  return rows.map(toBuilderProduct);
}

/* ---------------------------------------------------------------------------
 * Reference data
 * ------------------------------------------------------------------------ */

/**
 * Placements and sizes for a product, plus the palette and the tiers.
 *
 * Placements come from the product's **customisation profile**, which is what
 * `UX.md` section 5 means by "filtered by product type — a cap has no back
 * placement". When a product has no profile the default profile is used, so a
 * newly created product is configurable rather than broken.
 */
export async function loadBuilderReferenceData(
  productSlug: string | null,
): Promise<BuilderReferenceData> {
  const profile = await resolveProfile(productSlug);

  const [placements, embroiderySizes, threadColors, discountTiers, settings] =
    await Promise.all([
      profile
        ? prisma.profilePlacement.findMany({
            where: { profileId: profile.id, placement: { isActive: true } },
            select: {
              priceModifier: true,
              placement: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  description: true,
                  maxWidthMm: true,
                  maxHeightMm: true,
                },
              },
            },
            orderBy: { position: 'asc' },
          })
        : Promise.resolve([]),

      profile
        ? prisma.profileEmbroiderySize.findMany({
            where: { profileId: profile.id, embroiderySize: { isActive: true } },
            select: {
              embroiderySize: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  description: true,
                  maxWidthMm: true,
                  maxHeightMm: true,
                  basePrice: true,
                },
              },
            },
            orderBy: { position: 'asc' },
          })
        : Promise.resolve([]),

      prisma.threadColor.findMany({
        where: { isActive: true },
        select: { id: true, name: true, hexColor: true },
        orderBy: { position: 'asc' },
      }),

      prisma.discountTier.findMany({
        where: { isActive: true },
        select: { minQuantity: true, maxQuantity: true, discountBasisPoints: true },
        orderBy: { minQuantity: 'asc' },
      }),

      loadBuilderSettings(),
    ]);

  return {
    placements: placements.map((row) => ({
      ...row.placement,
      priceModifier: row.priceModifier,
    })),
    embroiderySizes: embroiderySizes.map((row) => row.embroiderySize),
    threadColors,
    discountTiers,
    settings,
  };
}

async function resolveProfile(productSlug: string | null) {
  if (productSlug) {
    const product = await prisma.product.findFirst({
      where: { slug: productSlug, deletedAt: null },
      select: { customizationProfile: { select: { id: true } } },
    });

    if (product?.customizationProfile) return product.customizationProfile;
  }

  return prisma.customizationProfile.findFirst({
    where: { isDefault: true, isActive: true },
    select: { id: true },
  });
}

/* ---------------------------------------------------------------------------
 * Request submission: resolving references, and the write
 * ------------------------------------------------------------------------ */

export type ResolvedReferences = {
  product: { id: string; name: string; basePrice: number };
  variant: { id: string; sku: string; priceOverride: number | null } | null;
  /**
   * The face the design was dropped on, when the customer had one to drop it on.
   *
   * Null when the blank has no measured photograph yet — a real state, not an
   * error (ADR-035). It sends the configuration to a human quote rather than
   * refusing it, so an unfinished catalogue looks like a shop that has to check
   * rather than a shop that is broken.
   */
  surface: {
    imageId: string;
    surface: string;
    widthMm: number;
    widthPx: number | null;
    heightPx: number | null;
  } | null;
  /** Every priced band on this product's profile, for the size lookup. */
  sizeBands: readonly {
    id: string;
    name: string;
    basePrice: number;
    maxWidthMm: number | null;
    maxHeightMm: number | null;
  }[];
  threadColors: readonly { id: string; name: string }[];
  discountTiers: readonly DiscountTier[];
};

export type ReferenceResolution =
  | { ok: true; references: ResolvedReferences }
  | { ok: false; reason: 'PRODUCT' | 'VARIANT' | 'PLACEMENT' | 'SIZE' | 'THREAD_COLOR' };

/**
 * Re-read everything a submitted request refers to.
 *
 * The security boundary for a custom request. Nothing the client sent is
 * trusted as a fact: the product must be published *and* customisable, the
 * variant must belong to it and be active, and the placement and size must
 * belong to **this product's** customisation profile — otherwise a customer
 * could request a cap's front panel on a tote bag by editing a payload.
 *
 * Prices come back from these rows, never from the client.
 */
export async function resolveRequestReferences(input: {
  productSlug: string;
  variantSku: string | null;
  /** The photograph the design was placed on. Null when the blank has none. */
  surfaceImageId: string | null;
  threadColorIds: readonly string[];
}): Promise<ReferenceResolution> {
  const product = await prisma.product.findFirst({
    where: {
      slug: input.productSlug,
      isCustomizable: true,
      status: 'ACTIVE',
      deletedAt: null,
      publishedAt: { not: null, lte: new Date() },
    },
    select: {
      id: true,
      name: true,
      basePrice: true,
      customizationProfileId: true,
      variants: { select: { id: true, sku: true, priceOverride: true, isActive: true } },
    },
  });

  if (!product) return { ok: false, reason: 'PRODUCT' };

  const variant =
    input.variantSku === null
      ? null
      : (product.variants.find(
          (candidate) => candidate.sku === input.variantSku && candidate.isActive,
        ) ?? null);

  if (input.variantSku !== null && variant === null)
    return { ok: false, reason: 'VARIANT' };

  const profileId = product.customizationProfileId;

  /*
   * The surface, scoped to **this product**.
   *
   * The id arrives from a browser and decides which garment a customer's design
   * is measured against — a photograph of a different product would produce a
   * millimetre figure computed from the wrong calibration, which is a wrong
   * order that looks right on every screen. So the `productId` is part of the
   * query rather than checked afterwards.
   */
  const surface = input.surfaceImageId
    ? await prisma.productImage.findFirst({
        where: {
          id: input.surfaceImageId,
          productId: product.id,
          surface: { not: null },
          surfaceWidthMm: { not: null },
        },
        select: {
          id: true,
          surface: true,
          surfaceWidthMm: true,
          width: true,
          height: true,
        },
      })
    : null;

  if (input.surfaceImageId !== null && surface === null) {
    return { ok: false, reason: 'PLACEMENT' };
  }

  // Every band the product's profile offers. The one that prices the design is
  // chosen by `domain/customization/placement`, from the size the customer
  // actually dragged — not from anything the browser claimed.
  const bands = profileId
    ? await prisma.profileEmbroiderySize.findMany({
        where: { profileId, embroiderySize: { isActive: true } },
        select: {
          embroiderySize: {
            select: {
              id: true,
              name: true,
              basePrice: true,
              maxWidthMm: true,
              maxHeightMm: true,
            },
          },
        },
        orderBy: { position: 'asc' },
      })
    : [];

  if (bands.length === 0) return { ok: false, reason: 'SIZE' };

  const threadColors = await prisma.threadColor.findMany({
    where: { id: { in: [...input.threadColorIds] }, isActive: true },
    select: { id: true, name: true },
  });

  if (threadColors.length !== input.threadColorIds.length) {
    return { ok: false, reason: 'THREAD_COLOR' };
  }

  const discountTiers = await prisma.discountTier.findMany({
    where: { isActive: true },
    select: { minQuantity: true, maxQuantity: true, discountBasisPoints: true },
    orderBy: { minQuantity: 'asc' },
  });

  return {
    ok: true,
    references: {
      product: { id: product.id, name: product.name, basePrice: product.basePrice },
      variant: variant
        ? { id: variant.id, sku: variant.sku, priceOverride: variant.priceOverride }
        : null,
      surface: surface
        ? {
            imageId: surface.id,
            surface: surface.surface as string,
            widthMm: surface.surfaceWidthMm as number,
            widthPx: surface.width,
            heightPx: surface.height,
          }
        : null,
      sizeBands: bands.map((band) => band.embroiderySize),
      threadColors,
      discountTiers,
    },
  };
}

export type PersistRequestInput = {
  requestNumber: string;
  /**
   * The account the request belongs to, when a signed-in customer submitted it.
   *
   * A guest's request has none, and is claimed later by the account whose
   * e-mail address it names (Phase 10). Setting it here is what makes a request
   * submitted while signed in appear in that customer's portal immediately
   * rather than only once it has been priced.
   */
  userId: string | null;
  productId: string;
  variantId: string | null;
  /**
   * Where the design goes, as the customer positioned it (ADR-035).
   *
   * All four numbers or none: half a transform is a design at an unknown
   * position, which renders somewhere plausible and wrong. The database says so
   * too (`customization_configs_design_transform_complete`).
   */
  placement: {
    surface: string;
    surfaceImageId: string;
    xPercent: number;
    yPercent: number;
    widthPercent: number;
    rotationDeg: number;
    label: string;
  } | null;
  /** The band that prices it, or null when none covers the dragged size. */
  embroiderySizeId: string | null;
  embroideryWidthMm: number | null;
  embroideryHeightMm: number | null;
  embroideryText: string | null;
  threadColorIds: readonly string[];
  instructions: string | null;
  quantity: number;
  /**
   * Design files to attach, already resolved to this owner's `READY` files by
   * the service. Written inside the same transaction as the configuration:
   * Phase 7's invariant is that a request with no artwork is better than a
   * request whose artwork failed to link.
   */
  designFileIds: readonly string[];
  pricingMode: 'FIXED' | 'QUOTE';
  pricingModeReason: string | null;
  estimateMin: number;
  estimateMax: number;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  customerNote: string | null;
  /**
   * Announced inside the same transaction (`ARCHITECTURE.md` section 11).
   *
   * The request id only exists once the transaction has created it, so the
   * caller passes a closure rather than a prepared row.
   */
  onSubmitted?: (input: {
    tx: NotificationTx;
    requestId: string;
    requestNumber: string;
  }) => Promise<void>;
};

/**
 * Write the configuration, the request, its item and its first event.
 *
 * One transaction, per `ARCHITECTURE.md` section 6: a request whose
 * configuration failed to write is worse than no request at all, because the
 * owner sees a job with nothing to make.
 */
export async function persistCustomRequest(input: PersistRequestInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const config = await tx.customizationConfig.create({
      data: {
        ownerUserId: input.userId,
        productId: input.productId,
        variantId: input.variantId,
        /*
         * The placement, as four percentages and a face.
         *
         * `placementId` — the named zone the builder used to ask for — is
         * deliberately not written. Freeform placement replaced the list
         * (ADR-035); the column stays for the rows that predate this phase, and
         * writing a guess into it would make an old configuration and a new one
         * indistinguishable.
         */
        designSurface: input.placement?.surface as never,
        designSurfaceImageId: input.placement?.surfaceImageId ?? null,
        designXPercent: input.placement?.xPercent ?? null,
        designYPercent: input.placement?.yPercent ?? null,
        designWidthPercent: input.placement?.widthPercent ?? null,
        designRotationDeg: input.placement?.rotationDeg ?? null,
        designSurfaceLabel: input.placement?.label ?? null,
        embroiderySizeId: input.embroiderySizeId,
        embroideryWidthMm: input.embroideryWidthMm,
        embroideryHeightMm: input.embroideryHeightMm,
        embroideryText: input.embroideryText,
        threadColorCount: input.threadColorIds.length,
        instructions: input.instructions,
        pricingMode: input.pricingMode,
        pricingModeReason: input.pricingModeReason,
        // 2.4.3: snapshotted for the admin's reference. Never binding.
        estimateMin: input.estimateMin,
        estimateMax: input.estimateMax,
        threadColors: {
          create: input.threadColorIds.map((threadColorId, position) => ({
            threadColorId,
            position,
          })),
        },
        files: {
          // The first file is the design; the rest are references
          // (`DesignFileRole`). A customer sending several usually sends the
          // logo first and a photograph of where they want it second.
          create: input.designFileIds.map((designFileId, position) => ({
            designFileId,
            role: position === 0 ? ('PRIMARY' as const) : ('REFERENCE' as const),
            position,
          })),
        },
      },
      select: { id: true },
    });

    const request = await tx.customRequest.create({
      data: {
        requestNumber: input.requestNumber,
        userId: input.userId,
        status: 'SUBMITTED',
        source: 'BUILDER',
        pricingMode: input.pricingMode,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        estimateMin: input.estimateMin,
        estimateMax: input.estimateMax,
        customerNote: input.customerNote,
        submittedAt: new Date(),
        items: {
          create: [
            {
              customizationConfigId: config.id,
              quantity: input.quantity,
              estimateMin: input.estimateMin,
              estimateMax: input.estimateMax,
              position: 0,
            },
          ],
        },
        events: {
          create: [
            {
              type: 'STATUS_CHANGE',
              toStatus: 'SUBMITTED',
              actorType: 'CUSTOMER',
              message: 'Demande envoyée depuis le configurateur.',
              isCustomerVisible: true,
            },
          ],
        },
      },
      select: { id: true },
    });

    if (input.onSubmitted) {
      await input.onSubmitted({
        tx,
        requestId: request.id,
        requestNumber: input.requestNumber,
      });
    }
  });
}

/**
 * The next human-facing request number.
 *
 * `next_request_number()` is a PostgreSQL function over `request_number_seq`,
 * added by the Phase 8 migration and seeded past the highest number Phase 7 had
 * already issued. `nextval` never blocks and never repeats, so two simultaneous
 * submissions get two numbers; the cost is a gap when a transaction rolls back,
 * which is the right trade for an identifier whose only job is to be unique and
 * readable aloud (ADR-023).
 *
 * This replaces the Phase 7 read of `MAX(request_number)`, whose race the
 * Phase 7 audit recorded. The migration shipped in Phase 8; the call site did
 * not, and Phase 10 — where every quote begins with a request — is where the
 * collision started happening.
 */
export async function nextRequestNumber(): Promise<string> {
  const [row] = await prisma.$queryRaw<
    { request_number: string }[]
  >`SELECT next_request_number() AS request_number`;

  return row!.request_number;
}
