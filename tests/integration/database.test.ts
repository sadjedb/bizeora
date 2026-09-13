/**
 * Database foundation tests.
 *
 * These run against a real, migrated, seeded PostgreSQL database. They verify
 * the schema invariants that would be expensive to discover later: the seeded
 * business values, the basis-point convention (ADR-018), and the CHECK
 * constraints and partial indexes that Prisma cannot express and that are
 * therefore easy to lose in a migration.
 *
 * They are deliberately narrow. Business behaviour belongs to the domain layer
 * and its own tests; this file asks only "did the database get built the way
 * the documentation says".
 */

import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/generated/prisma/client';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: connectionString ?? '' }),
});

/** Rows created by a test, removed afterwards so the suite stays repeatable. */
const createdTierIds: string[] = [];
const probeUserIds: string[] = [];

beforeAll(async () => {
  if (!connectionString) {
    throw new Error(
      'DIRECT_URL or DATABASE_URL must be set. Run: npm run db:migrate && npm run db:seed',
    );
  }
  await prisma.$connect();
});

afterAll(async () => {
  if (createdTierIds.length > 0) {
    await prisma.discountTier.deleteMany({ where: { id: { in: createdTierIds } } });
  }
  if (probeUserIds.length > 0) {
    // Sessions and accounts go with them: both cascade on user delete.
    await prisma.user.deleteMany({ where: { id: { in: probeUserIds } } });
  }
  await prisma.$disconnect();
});

describe('connection and migration', () => {
  it('connects and reports the expected engine', async () => {
    const rows = await prisma.$queryRaw<
      Array<{ version: string }>
    >`SELECT version() AS version`;

    expect(rows[0]?.version).toContain('PostgreSQL');
  });

  it('has applied the initial migration', async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.migration_name.endsWith('_init'))).toBe(true);
  });

  it('has the citext extension that users.email and coupons.code depend on', async () => {
    const rows = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'citext'
    `;

    expect(rows).toHaveLength(1);
  });

  it('generates UUID v7 primary keys', async () => {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT uuidv7() AS id`;
    const id = rows[0]?.id ?? '';

    // Version nibble is the first character of the third group.
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe('seeded reference data', () => {
  it('has all 58 wilayas', async () => {
    expect(await prisma.wilaya.count()).toBe(58);
  });

  it('assigns every wilaya to exactly one shipping zone', async () => {
    const unzoned = await prisma.$queryRaw<Array<{ code: number }>>`
      SELECT w.code FROM wilayas w
      LEFT JOIN shipping_zone_wilayas z ON z.wilaya_code = w.code
      WHERE z.wilaya_code IS NULL
    `;

    // DATABASE.md constraint 12. Uniqueness is enforced by the database; full
    // coverage is a seed responsibility, and an unzoned wilaya blocks checkout
    // for that province (BUSINESS-RULES.md 4.4).
    expect(unzoned).toEqual([]);
    expect(await prisma.shippingZoneWilaya.count()).toBe(58);
  });

  it('has a home and desk rate for every zone', async () => {
    const zones = await prisma.shippingZone.findMany({ include: { rates: true } });

    expect(zones).toHaveLength(3);
    for (const zone of zones) {
      const types = zone.rates.map((r) => r.deliveryType).sort();
      expect(types).toEqual(['DESK', 'HOME']);
    }
  });
});

describe('discount tiers (ADR-017)', () => {
  it('seeds exactly the four documented tiers, in basis points', async () => {
    const tiers = await prisma.discountTier.findMany({
      where: { isActive: true },
      orderBy: { minQuantity: 'asc' },
    });

    expect(
      tiers.map((t) => ({
        min: t.minQuantity,
        max: t.maxQuantity,
        bp: t.discountBasisPoints,
      })),
    ).toEqual([
      { min: 1, max: 9, bp: 0 },
      { min: 10, max: 24, bp: 500 },
      { min: 25, max: 49, bp: 1000 },
      { min: 50, max: null, bp: 1500 },
    ]);
  });

  it('stores basis points as integers, never fractions', async () => {
    const tiers = await prisma.discountTier.findMany();

    for (const tier of tiers) {
      expect(Number.isInteger(tier.discountBasisPoints)).toBe(true);
      // A fraction such as 0.15 would round to 0; a whole percent such as 15
      // would be a hundredth of the intended discount. Both are caught here.
      expect(tier.discountBasisPoints % 1).toBe(0);
    }

    const top = tiers.find((t) => t.maxQuantity === null);
    expect(top?.discountBasisPoints).toBe(1500);
  });

  it('covers every quantity with exactly one active tier', async () => {
    const tiers = await prisma.discountTier.findMany({ where: { isActive: true } });

    for (const quantity of [1, 9, 10, 24, 25, 49, 50, 500]) {
      const matches = tiers.filter(
        (t) =>
          t.minQuantity <= quantity &&
          (t.maxQuantity === null || t.maxQuantity >= quantity),
      );
      expect(matches, `quantity ${quantity}`).toHaveLength(1);
    }
  });

  it('rejects a discount above 100% (basis-point range check)', async () => {
    await expect(
      prisma.discountTier.create({
        data: {
          minQuantity: 900,
          maxQuantity: 999,
          discountBasisPoints: 10_001,
          label: 'invalid',
        },
      }),
    ).rejects.toThrow(/discount_tiers_basis_points_range/);
  });

  it('rejects a tier whose maximum is below its minimum', async () => {
    await expect(
      prisma.discountTier.create({
        data: {
          minQuantity: 900,
          maxQuantity: 800,
          discountBasisPoints: 100,
          label: 'invalid',
        },
      }),
    ).rejects.toThrow(/discount_tiers_max_after_min/);
  });

  it('rejects a minimum quantity below 1', async () => {
    await expect(
      prisma.discountTier.create({
        data: {
          minQuantity: 0,
          maxQuantity: 5,
          discountBasisPoints: 100,
          label: 'invalid',
        },
      }),
    ).rejects.toThrow(/discount_tiers_min_quantity_positive/);
  });

  it('allows only one active tier per lower bound (partial unique index)', async () => {
    const created = await prisma.discountTier.create({
      data: {
        minQuantity: 950,
        maxQuantity: 960,
        discountBasisPoints: 100,
        label: 'probe',
      },
    });
    createdTierIds.push(created.id);

    await expect(
      prisma.discountTier.create({
        data: {
          minQuantity: 950,
          maxQuantity: 970,
          discountBasisPoints: 200,
          label: 'duplicate',
        },
      }),
    ).rejects.toThrow();

    // The index is partial: an inactive row at the same bound is permitted.
    const inactive = await prisma.discountTier.create({
      data: {
        minQuantity: 950,
        maxQuantity: 980,
        discountBasisPoints: 300,
        label: 'inactive duplicate',
        isActive: false,
      },
    });
    createdTierIds.push(inactive.id);
    expect(inactive.isActive).toBe(false);
  });
});

describe('settings (ADR-018)', () => {
  it('seeds every documented custom_orders key', async () => {
    const rows = await prisma.setting.findMany({ where: { group: 'custom_orders' } });
    const keys = rows.map((r) => r.key).sort();

    expect(keys).toEqual(
      [
        'custom_orders.acceptanceValidityDays',
        'custom_orders.depositPercent',
        'custom_orders.depositWindowDays',
        'custom_orders.estimateBandPercent',
        'custom_orders.maxThreadColors',
        'custom_orders.quoteThresholdInstructionLength',
        'custom_orders.quoteThresholdQuantity',
        'custom_orders.quoteThresholdThreadColors',
        'custom_orders.quoteValidityDays',
        'custom_orders.responseTimeHours',
        // The four surcharge rates BUSINESS-RULES.md 2.2 reads from settings.
        // Added in Phase 7, when the builder first needed to price a
        // configuration; DATABASE.md section 14 lists them.
        'custom_orders.setupFee',
        'custom_orders.setupFeeWaiverQuantity',
        'custom_orders.textSurcharge',
        'custom_orders.threadColorSurchargePerColor',
      ].sort(),
    );
  });

  it('stores the locked V1 values exactly', async () => {
    const expected: Record<string, string> = {
      'custom_orders.depositPercent': '5000',
      'custom_orders.quoteValidityDays': '14',
      'custom_orders.acceptanceValidityDays': '7',
      'custom_orders.quoteThresholdQuantity': '10',
      'custom_orders.quoteThresholdThreadColors': '3',
      'custom_orders.quoteThresholdInstructionLength': '200',
      'custom_orders.maxThreadColors': '8',
      'custom_orders.estimateBandPercent': '1500',
    };

    for (const [key, value] of Object.entries(expected)) {
      const setting = await prisma.setting.findUnique({ where: { key } });
      expect(setting?.value, key).toBe(value);
    }
  });

  it('stores percentages as basis-point integers, not fractions', async () => {
    for (const key of [
      'custom_orders.depositPercent',
      'custom_orders.estimateBandPercent',
    ]) {
      const setting = await prisma.setting.findUnique({ where: { key } });
      const numeric = Number(setting?.value);

      expect(Number.isInteger(numeric), key).toBe(true);
      // 0.5 or 50 would both be defects for a 50% deposit.
      expect(numeric, key).toBeGreaterThanOrEqual(100);
      expect(numeric, key).toBeLessThanOrEqual(10_000);
    }

    const deposit = await prisma.setting.findUnique({
      where: { key: 'custom_orders.depositPercent' },
    });
    expect(deposit?.value).toBe('5000');
    expect(deposit?.value).not.toBe('0.5');
    expect(deposit?.value).not.toBe('50');
  });
});

describe('documented check constraints', () => {
  it('rejects a review rating outside 1..5', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO reviews (product_id, user_id, rating, body, updated_at)
        VALUES (uuidv7(), uuidv7(), 9, 'invalid', now())
      `,
    ).rejects.toThrow(/reviews_rating_range|violates foreign key/);
  });

  it('rejects negative stock', async () => {
    await expect(
      prisma.$executeRaw`
        UPDATE product_variants SET stock_quantity = -1 WHERE false
      `,
    ).resolves.toBeDefined();

    const constraint = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conname = 'product_variants_stock_non_negative'
    `;
    expect(constraint).toHaveLength(1);
  });

  it('has the order and quote total-reconciliation constraints', async () => {
    const rows = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conname IN ('orders_totals_reconcile', 'quotes_totals_reconcile',
                        'order_items_line_total_reconciles',
                        'quote_items_line_total_reconciles')
    `;

    expect(rows.map((r) => r.conname).sort()).toEqual([
      'order_items_line_total_reconciles',
      'orders_totals_reconcile',
      'quote_items_line_total_reconciles',
      'quotes_totals_reconcile',
    ]);
  });

  it('has the FEE line-shape constraints on both cart and order items', async () => {
    const rows = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conname IN ('cart_items_kind_shape', 'order_items_kind_shape')
    `;

    expect(rows).toHaveLength(2);
  });

  it('has the soft-delete-aware unique indexes', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('users_email_active_key', 'products_slug_active_key',
                          'categories_slug_active_key',
                          'reviews_user_product_active_key')
    `;

    expect(rows).toHaveLength(4);
  });
});

/**
 * Better Auth schema reconciliation (Phase 2.3, ADR-006 amendment).
 *
 * These assert the *shape* the library's Prisma adapter will query, and that
 * the Phase 2 fields it cannot work with are gone. They deliberately do not
 * exercise Better Auth itself — the library is not installed until Phase 3,
 * and its behaviour is that phase's spike to prove.
 */
describe('Better Auth schema (ADR-006 amendment)', () => {
  /** Column name -> nullability and data type, for one table. */
  async function columnsOf(table: string) {
    const rows = await prisma.$queryRaw<
      Array<{
        column_name: string;
        data_type: string;
        udt_name: string;
        is_nullable: string;
      }>
    >`
      SELECT column_name, data_type, udt_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
    `;

    return new Map(rows.map((r) => [r.column_name, r]));
  }

  it('gives users every field Better Auth requires', async () => {
    const columns = await columnsOf('users');

    for (const required of ['id', 'name', 'email', 'email_verified', 'image']) {
      expect(columns.has(required), `users.${required} is missing`).toBe(true);
    }

    expect(columns.get('name')?.is_nullable).toBe('NO');
    expect(columns.get('email')?.is_nullable).toBe('NO');
    expect(columns.get('email')?.udt_name).toBe('citext');
  });

  it('stores email verification as a boolean, not a timestamp', async () => {
    const columns = await columnsOf('users');

    expect(columns.get('email_verified')?.data_type).toBe('boolean');
    expect(columns.get('email_verified')?.is_nullable).toBe('NO');
    expect(columns.has('email_verified_at')).toBe(false);
  });

  it('keeps the domain columns that belong to us, not to the library', async () => {
    const columns = await columnsOf('users');

    for (const own of ['role', 'status', 'phone', 'marketing_opt_in', 'deleted_at']) {
      expect(columns.has(own), `users.${own} was lost in the reconciliation`).toBe(true);
    }
  });

  it('represents the credential password on the account row, never on users', async () => {
    const users = await columnsOf('users');
    const accounts = await columnsOf('accounts');

    expect(users.has('password_hash')).toBe(false);
    expect(accounts.get('password')?.is_nullable).toBe('YES');
    expect(accounts.get('account_id')?.is_nullable).toBe('NO');
    expect(accounts.get('provider_id')?.is_nullable).toBe('NO');
    // NOT NULL since Phase 3 (ADR-019): `updatePassword` filters on `issuer`,
    // so a credential row without one can never change its password.
    expect(accounts.get('issuer')?.is_nullable).toBe('NO');

    for (const oauth of [
      'access_token',
      'refresh_token',
      'id_token',
      'access_token_expires_at',
      'refresh_token_expires_at',
      'scope',
    ]) {
      expect(accounts.get(oauth)?.is_nullable, `accounts.${oauth}`).toBe('YES');
    }

    expect(accounts.has('provider_account_id')).toBe(false);
    expect(accounts.has('expires_at')).toBe(false);
  });

  it('identifies an account by (issuer, accountId)', async () => {
    // Better Auth declares this unique index itself, and the `local:` /
    // `local:oauth:` issuer prefixes are what stop a local provider id from
    // colliding with an OAuth one. Phase 2.3 had it as
    // (providerId, accountId); ADR-019 corrected it against the installed
    // package.
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'accounts'
        AND indexname IN ('accounts_issuer_account_id_key',
                          'accounts_provider_id_account_id_key')
    `;

    expect(rows.map((r) => r.indexname)).toEqual(['accounts_issuer_account_id_key']);
  });

  it('uses sessions.token, not a hash, and keeps it unique', async () => {
    const columns = await columnsOf('sessions');

    expect(columns.get('token')?.is_nullable).toBe('NO');
    expect(columns.has('token_hash')).toBe(false);
    expect(columns.has('last_active_at')).toBe(false);
    expect(columns.get('updated_at')?.is_nullable).toBe('NO');

    const unique = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'sessions'
        AND indexname = 'sessions_token_key'
    `;

    expect(unique).toHaveLength(1);
    expect(unique[0]?.indexdef).toMatch(/CREATE UNIQUE INDEX/);
  });

  it('rejects a duplicate session token', async () => {
    const user = await prisma.user.create({
      data: { name: 'Schema Probe', email: `probe-${Date.now()}@example.invalid` },
    });
    probeUserIds.push(user.id);

    const token = `probe-token-${Date.now()}`;
    const expiresAt = new Date(Date.now() + 60_000);

    await prisma.session.create({ data: { userId: user.id, token, expiresAt } });

    await expect(
      prisma.session.create({ data: { userId: user.id, token, expiresAt } }),
    ).rejects.toThrow();
  });

  it('cascades sessions and accounts when a user is deleted', async () => {
    const user = await prisma.user.create({
      data: { name: 'Cascade Probe', email: `cascade-${Date.now()}@example.invalid` },
    });

    await prisma.session.create({
      data: {
        userId: user.id,
        token: `cascade-token-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        issuer: 'local:credential',
        password: '$argon2id$placeholder-not-a-real-hash',
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0);
  });

  it('uses the generic verification table, with no consumedAt and no type enum', async () => {
    const columns = await columnsOf('verification');

    expect([...columns.keys()].sort()).toEqual([
      'created_at',
      'expires_at',
      'id',
      'identifier',
      'updated_at',
      'value',
    ]);
  });

  it('has dropped the incompatible Phase 2 verification design', async () => {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'verification_tokens'
    `;
    expect(tables).toHaveLength(0);

    const enums = await prisma.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type WHERE typname = 'verification_token_type'
    `;
    expect(enums).toHaveLength(0);
  });

  it('keeps the email uniqueness partial, so an anonymised account frees the address', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'users_email_active_key'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toMatch(/WHERE \(deleted_at IS NULL\)/);
  });
});
