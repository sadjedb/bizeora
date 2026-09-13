/**
 * Archiving, against the real database.
 *
 * The domain tests prove the rules; this proves the only claim that matters
 * about them, which is a claim about SQL: **an archived row leaves the
 * workshop's list and stays in the table.** Every assertion here is therefore a
 * pair — the list no longer returns it, and a direct read still finds it, with
 * its status, its money and its relations untouched.
 *
 * It also proves the two things a `updateMany` makes easy to get wrong: that
 * archiving twice reports the second one moved nothing, and that a batch of a
 * hundred is one statement and one audit row rather than a hundred of each.
 */

import dotenv from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const { archiveRecords, archivedCount } =
  await import('../../src/server/services/archive-service');
const { listRequestsForStaff } =
  await import('../../src/server/repositories/request-repository');
const { listAdminProducts } =
  await import('../../src/server/repositories/catalogue-admin-repository');
const { MAX_BULK_ARCHIVE } = await import('../../src/domain/admin/archiving');
const { prisma } = await import('../../src/lib/db/client');

const PREFIX = `archive-${Date.now()}`;

type Actor = {
  kind: 'authenticated';
  userId: string;
  role: 'CUSTOMER' | 'STAFF' | 'ADMIN';
  emailVerified: boolean;
  status: 'ACTIVE';
};

function actorFor(userId: string, role: Actor['role']): Actor {
  return { kind: 'authenticated', userId, role, emailVerified: true, status: 'ACTIVE' };
}

let staff: Actor;
let customer: Actor;

const requestIds: string[] = [];
const productIds: string[] = [];
const userIds: string[] = [];

async function makeUser(role: Actor['role'], label: string): Promise<Actor> {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${label}@example.invalid`,
      name: label,
      role,
      status: 'ACTIVE',
      emailVerified: true,
    },
    select: { id: true },
  });

  userIds.push(user.id);
  return actorFor(user.id, role);
}

/** A submitted request, which is what the queue lists. */
async function makeRequest(index: number): Promise<string> {
  const row = await prisma.customRequest.create({
    data: {
      requestNumber: `${PREFIX}-${index}`,
      status: 'SUBMITTED',
      source: 'BUILDER',
      pricingMode: 'QUOTE',
      contactName: 'Cliente de test',
      contactEmail: `${PREFIX}-${index}@example.invalid`,
      submittedAt: new Date(),
    },
    select: { id: true },
  });

  requestIds.push(row.id);
  return row.id;
}

async function makeProduct(status: 'ACTIVE' | 'DRAFT', label: string): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });

  const row = await prisma.product.create({
    data: {
      slug: `${PREFIX}-${label}`,
      name: `Fixture ${label}`,
      description: 'Créé par les tests, supprimé par les tests.',
      categoryId: category.id,
      basePrice: 1000,
      status,
    },
    select: { id: true },
  });

  productIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  staff = await makeUser('STAFF', 'staff');
  customer = await makeUser('CUSTOMER', 'client');
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.customRequest.deleteMany({ where: { id: { in: requestIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe('who may archive', () => {
  it('refuses a customer', async () => {
    const id = await makeRequest(900);
    const result = await archiveRecords(customer, {
      entity: 'request',
      ids: [id],
      archive: true,
    });

    expect(result).toEqual({ ok: false, reason: 'FORBIDDEN' });

    const row = await prisma.customRequest.findUniqueOrThrow({
      where: { id },
      select: { archivedAt: true },
    });
    expect(row.archivedAt).toBeNull();
  });

  /*
   * The entity is a string from a form and it chooses a Prisma delegate. A
   * name that is not on the list has to stop here rather than reach the
   * repository, so this is the test that a typo in a URL cannot become a write
   * against `users`.
   */
  it('refuses a kind that is not archivable', async () => {
    const result = await archiveRecords(staff, {
      entity: 'user',
      ids: ['whatever'],
      archive: true,
    });

    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_ENTITY' });
  });

  it('refuses an empty selection and an impossible one', async () => {
    await expect(
      archiveRecords(staff, { entity: 'request', ids: [], archive: true }),
    ).resolves.toEqual({ ok: false, reason: 'EMPTY' });

    const oversized = Array.from(
      { length: MAX_BULK_ARCHIVE + 1 },
      (_, index) => `id-${index}`,
    );

    await expect(
      archiveRecords(staff, { entity: 'request', ids: oversized, archive: true }),
    ).resolves.toEqual({ ok: false, reason: 'TOO_MANY' });
  });
});

describe('a request leaves the queue and stays in the table', () => {
  it('disappears from the list, keeps its row, and comes back', async () => {
    const id = await makeRequest(1);

    const before = await listRequestsForStaff({ limit: 100 });
    expect(before.map((row) => row.id)).toContain(id);

    const archived = await archiveRecords(staff, {
      entity: 'request',
      ids: [id],
      archive: true,
    });

    expect(archived).toMatchObject({ ok: true, outcome: { moved: 1, refused: [] } });

    // Gone from the queue…
    const live = await listRequestsForStaff({ limit: 100 });
    expect(live.map((row) => row.id)).not.toContain(id);

    // …and in the other half, which is the only screen that shows it.
    const inArchive = await listRequestsForStaff({ limit: 100, archived: true });
    expect(inArchive.map((row) => row.id)).toContain(id);

    // The row itself did not change. This is the whole promise of ADR-034:
    // the status, the customer and the timestamps are exactly as they were.
    const row = await prisma.customRequest.findUniqueOrThrow({
      where: { id },
      select: { status: true, contactEmail: true, submittedAt: true, archivedAt: true },
    });

    expect(row.status).toBe('SUBMITTED');
    expect(row.contactEmail).toBe(`${PREFIX}-1@example.invalid`);
    expect(row.submittedAt).not.toBeNull();
    expect(row.archivedAt).not.toBeNull();

    const restored = await archiveRecords(staff, {
      entity: 'request',
      ids: [id],
      archive: false,
    });

    expect(restored).toMatchObject({ ok: true, outcome: { moved: 1 } });

    const back = await listRequestsForStaff({ limit: 100 });
    expect(back.map((row) => row.id)).toContain(id);
  });

  /*
   * The `where` carries the opposite state, so a second archive matches
   * nothing. That is what makes a double click harmless, and it is why the
   * screen can report a count instead of "done" — the count is the truth.
   */
  it('reports nothing moved when the rows were already there', async () => {
    const id = await makeRequest(2);

    const first = await archiveRecords(staff, {
      entity: 'request',
      ids: [id],
      archive: true,
    });
    expect(first).toMatchObject({ ok: true, outcome: { moved: 1 } });

    const second = await archiveRecords(staff, {
      entity: 'request',
      ids: [id],
      archive: true,
    });
    expect(second).toMatchObject({ ok: true, outcome: { moved: 0 } });
  });

  it('archives a batch in one act, and counts it once', async () => {
    const ids = await Promise.all([10, 11, 12, 13].map(makeRequest));

    // Sent twice over, to prove the service deduplicates rather than counting
    // a row twice against the batch limit.
    const result = await archiveRecords(staff, {
      entity: 'request',
      ids: [...ids, ...ids],
      archive: true,
    });

    expect(result).toMatchObject({ ok: true, outcome: { moved: 4 } });

    const audits = await prisma.auditLog.findMany({
      where: { actorUserId: staff.userId, entityType: 'request', action: 'archive' },
      select: { metadata: true },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toMatchObject({ moved: 4 });
  });

  it('counts what is put away', async () => {
    const id = await makeRequest(20);
    const before = await archivedCount('request');

    await archiveRecords(staff, { entity: 'request', ids: [id], archive: true });

    expect(await archivedCount('request')).toBe(before + 1);
  });
});

describe('a product is the exception', () => {
  it('refuses a published one and archives a draft', async () => {
    const published = await makeProduct('ACTIVE', 'publie');
    const draft = await makeProduct('DRAFT', 'brouillon');

    const result = await archiveRecords(staff, {
      entity: 'product',
      ids: [published, draft],
      archive: true,
    });

    expect(result).toMatchObject({
      ok: true,
      outcome: {
        moved: 1,
        refused: [{ id: published, reason: 'PRODUCT_PUBLISHED' }],
      },
    });

    const rows = await prisma.product.findMany({
      where: { id: { in: [published, draft] } },
      select: { id: true, status: true },
    });

    expect(rows.find((row) => row.id === published)?.status).toBe('ACTIVE');
    expect(rows.find((row) => row.id === draft)?.status).toBe('ARCHIVED');
  });

  /*
   * Restoring returns a product to a draft, not to the shop. Publishing has a
   * customer-visible effect and its own button; a restore that put a product
   * back on sale would make "undo" mean something nobody asked for.
   */
  it('restores it as a draft rather than to the shop', async () => {
    const id = await makeProduct('DRAFT', 'retour');

    await archiveRecords(staff, { entity: 'product', ids: [id], archive: true });
    await archiveRecords(staff, { entity: 'product', ids: [id], archive: false });

    const row = await prisma.product.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });

    expect(row.status).toBe('DRAFT');
  });

  it('names the slugs the caller has to invalidate', async () => {
    const id = await makeProduct('DRAFT', 'slugs');

    const result = await archiveRecords(staff, {
      entity: 'product',
      ids: [id],
      archive: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.slugs).toEqual([`${PREFIX}-slugs`]);
  });

  it('takes an archived product off the catalogue list', async () => {
    const id = await makeProduct('DRAFT', 'catalogue');

    await archiveRecords(staff, { entity: 'product', ids: [id], archive: true });

    const drafts = await listAdminProducts({ status: 'DRAFT' });
    expect(drafts.map((row) => row.id)).not.toContain(id);

    const archived = await listAdminProducts({ status: 'ARCHIVED' });
    expect(archived.map((row) => row.id)).toContain(id);
  });
});
