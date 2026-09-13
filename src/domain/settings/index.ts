/**
 * The settings an owner may change, and what a valid value is.
 *
 * The `settings` table has existed since Phase 2 and has been read from the
 * first day — every price rate, every quote threshold, the deposit percentage.
 * What never existed was a screen, so changing any of them meant a SQL client,
 * and two of them have bitten this project already: `notifications.
 * adminRecipients` was empty, which silently dropped every "new order" e-mail
 * to the workshop, and `brand.name` was seeded and then read from a TypeScript
 * constant instead.
 *
 * This is the catalogue of what the screen offers. It is **not** every row in
 * the table: a setting nobody should change from a browser does not appear
 * here, and appearing here is what makes a setting editable.
 *
 * ## Why the bounds live in the domain
 *
 * Every one of these values is read by something that assumes it is sane. A
 * deposit of 150 % produces an order that can never be paid; a response time of
 * zero hours is a promise on the front page that the shop breaks by existing;
 * an empty brand name is a page whose `<title>` is a dash. The screen validates
 * against these, the server validates against these again, and neither invents
 * a rule of its own.
 *
 * Pure. No I/O, no Prisma, no framework.
 */

/* ---------------------------------------------------------------------------
 * The shape of a setting
 * ------------------------------------------------------------------------ */

/**
 * How a value is stored, and therefore how it is parsed and rendered.
 *
 * Mirrors the `SettingType` enum on the table rather than inventing a parallel
 * one. `MONEY` is an integer of minor units like every other amount in this
 * application (ADR-012); `PERCENT` is **basis points**, so 5000 is 50 %, which
 * is how `custom_orders.depositPercent` has always been stored.
 */
export type SettingKind =
  'TEXT' | 'EMAIL_LIST' | 'BOOLEAN' | 'NUMBER' | 'MONEY' | 'PERCENT';

export type SettingGroup =
  'brand' | 'availability' | 'accounts' | 'notifications' | 'pricing';

export type EditableSetting = {
  key: string;
  kind: SettingKind;
  group: SettingGroup;
  /** Inclusive, for the numeric kinds. */
  min?: number;
  max?: number;
  /** Longest accepted string, for the textual kinds. */
  maxLength?: number;
  /** A blank value is meaningful — "no WhatsApp number", "nobody to notify". */
  optional?: boolean;
};

/**
 * Everything the settings screen may write.
 *
 * Order matters: it is the order the screen renders, so it reads as a sensible
 * conversation rather than as a database dump.
 */
export const EDITABLE_SETTINGS: readonly EditableSetting[] = [
  /* --- what the shop is called ------------------------------------------ */
  { key: 'brand.name', kind: 'TEXT', group: 'brand', maxLength: 60 },
  {
    key: 'contact.whatsapp',
    kind: 'TEXT',
    group: 'brand',
    maxLength: 40,
    optional: true,
  },

  /* --- whether it is open ------------------------------------------------ */
  { key: 'site.storefrontEnabled', kind: 'BOOLEAN', group: 'availability' },

  /* --- how accounts behave ---------------------------------------------- */
  { key: 'accounts.emailVerificationRequired', kind: 'BOOLEAN', group: 'accounts' },

  /* --- who the workshop tells ------------------------------------------- */
  {
    key: 'notifications.adminRecipients',
    kind: 'EMAIL_LIST',
    group: 'notifications',
    maxLength: 500,
    optional: true,
  },
  {
    key: 'custom_orders.responseTimeHours',
    kind: 'NUMBER',
    group: 'notifications',
    min: 1,
    max: 168,
  },

  /* --- what it charges --------------------------------------------------- */
  {
    key: 'custom_orders.setupFee',
    kind: 'MONEY',
    group: 'pricing',
    min: 0,
    max: 10_000_000,
  },
  {
    key: 'custom_orders.textSurcharge',
    kind: 'MONEY',
    group: 'pricing',
    min: 0,
    max: 10_000_000,
  },
  {
    key: 'custom_orders.threadColorSurchargePerColor',
    kind: 'MONEY',
    group: 'pricing',
    min: 0,
    max: 10_000_000,
  },
  {
    key: 'custom_orders.setupFeeWaiverQuantity',
    kind: 'NUMBER',
    group: 'pricing',
    min: 1,
    max: 10_000,
  },
  {
    key: 'custom_orders.depositPercent',
    kind: 'PERCENT',
    group: 'pricing',
    min: 0,
    max: 10_000,
  },
  {
    key: 'custom_orders.quoteValidityDays',
    kind: 'NUMBER',
    group: 'pricing',
    min: 1,
    max: 365,
  },
];

const BY_KEY = new Map(EDITABLE_SETTINGS.map((setting) => [setting.key, setting]));

/**
 * The definition for a key, or nothing.
 *
 * The key arrives from a form. A key that is not on the list is not a setting
 * the screen offers, and writing it would let a crafted request change a row
 * nobody put behind a control — `custom_orders.maxThreadColors`, say, which is
 * a safety limit rather than a preference.
 */
export function editableSetting(key: string): EditableSetting | null {
  return BY_KEY.get(key) ?? null;
}

/* ---------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

export type SettingRefusal =
  | 'UNKNOWN_KEY'
  | 'REQUIRED'
  | 'TOO_LONG'
  | 'NOT_A_NUMBER'
  | 'OUT_OF_RANGE'
  | 'NOT_A_BOOLEAN'
  | 'BAD_EMAIL';

/**
 * A shape check, not a deliverability check.
 *
 * The same spirit as `isPlausibleEmail` in the builder: this is not trying to
 * decide whether an address exists, only whether somebody has typed something
 * that could be one. The provider is the authority on the rest, and it says so
 * loudly when it refuses.
 */
function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/** Splits on commas **or** whitespace, because people type both. */
export function parseEmailList(value: string): readonly string[] {
  return value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Whether this value may be stored under this key.
 *
 * Returns the refusal rather than throwing, because the screen shows every bad
 * field at once — a settings form that reveals one problem per save is a form
 * that takes six saves.
 */
export function validateSetting(key: string, raw: string): SettingRefusal | null {
  const setting = editableSetting(key);
  if (!setting) return 'UNKNOWN_KEY';

  const value = raw.trim();

  if (value === '' && !setting.optional && setting.kind !== 'BOOLEAN') {
    return 'REQUIRED';
  }

  switch (setting.kind) {
    case 'TEXT':
      return setting.maxLength && value.length > setting.maxLength ? 'TOO_LONG' : null;

    case 'EMAIL_LIST': {
      if (setting.maxLength && value.length > setting.maxLength) return 'TOO_LONG';
      if (value === '') return null;

      return parseEmailList(value).every(isPlausibleEmail) ? null : 'BAD_EMAIL';
    }

    case 'BOOLEAN':
      return value === 'true' || value === 'false' ? null : 'NOT_A_BOOLEAN';

    case 'NUMBER':
    case 'MONEY':
    case 'PERCENT': {
      // Integers only, everywhere. Money is minor units (ADR-012), a percentage
      // is basis points, and a count of hours is a count.
      if (!/^-?\d+$/.test(value)) return 'NOT_A_NUMBER';

      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) return 'NOT_A_NUMBER';

      if (setting.min !== undefined && parsed < setting.min) return 'OUT_OF_RANGE';
      if (setting.max !== undefined && parsed > setting.max) return 'OUT_OF_RANGE';

      return null;
    }
  }
}

/**
 * Every refusal in a submission, keyed by setting.
 *
 * A key the screen did not offer is reported rather than ignored: silently
 * dropping it would make a tampered payload look like a successful save.
 */
export function validateSettings(
  values: Readonly<Record<string, string>>,
): Readonly<Record<string, SettingRefusal>> {
  const refusals: Record<string, SettingRefusal> = {};

  for (const [key, value] of Object.entries(values)) {
    const refusal = validateSetting(key, value);
    if (refusal) refusals[key] = refusal;
  }

  return refusals;
}

/* ---------------------------------------------------------------------------
 * Reading values back
 * ------------------------------------------------------------------------ */

/**
 * A stored boolean, with an explicit default.
 *
 * Settings are strings in the database, and a row that has never been seeded is
 * absent rather than false. The default is therefore a parameter and never
 * assumed: "verification is required" and "the shop is open" both default to
 * *true*, so an incomplete database behaves like a cautious one.
 */
export function booleanSetting(
  value: string | undefined | null,
  fallback: boolean,
): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return fallback;
}
