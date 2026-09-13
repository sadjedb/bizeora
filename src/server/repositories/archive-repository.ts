import 'server-only';

import { prisma } from '@/lib/db/client';
import {
  productArchivable,
  type ArchivableEntity,
  type ArchiveRefusal,
} from '@/domain/admin/archiving';

/**
 * Moving rows on and off the workshop's screens.
 *
 * One module for all five kinds, because the operation is one operation: set a
 * timestamp, or clear it. What differs is only *where* the flag lives, and that
 * difference is worth stating once here rather than in five call sites:
 *
 *   - **orders, requests, quotes and reviews** carry `archived_at`. It is read
 *     by the admin's lists and by nothing else — no customer query mentions it
 *     — so archiving one is invisible to everybody outside the workshop.
 *   - **products** archive through `products.status`, which is customer-facing
 *     and already means "not for sale" (11.6). There is no second flag for
 *     them: a product with two archived-nesses would be a product whose
 *     visibility nobody could reason about.
 *
 * Every batch writes an audit row. Archiving is reversible, which is exactly
 * why the trail matters: "where did the order from Tuesday go" has an answer
 * that names a person and a moment.
 */

/**
 * `WHERE archived_at IS NULL`, or its opposite.
 *
 * Every workshop list takes an `archived` flag and passes it through here, so
 * the two halves of a queue are one query with one clause rather than two code
 * paths that can drift. Undefined means live, because the live list is what a
 * screen shows when nobody has asked for anything else.
 */
export function archiveWhere(archived: boolean | undefined) {
  return { archivedAt: archived ? { not: null } : null };
}

export type ArchiveWrite = {
  entity: ArchivableEntity;
  ids: readonly string[];
  actorUserId: string;
  /** `true` archives, `false` restores. */
  archive: boolean;
};

export type ArchiveWriteResult = {
  moved: number;
  refused: readonly { id: string; reason: ArchiveRefusal }[];
  /**
   * The slugs of the products that moved, for the caller's cache invalidation.
   *
   * Archiving a product changes what the storefront serves at
   * `/{locale}/shop/{slug}`, and a cached page is invalidated by concrete path
   * (rule 9C). The four timestamped kinds change nothing a visitor can see, so
   * this is empty for them.
   */
  slugs: readonly string[];
};

/** The four that carry a timestamp, and the Prisma delegate for each. */
const TIMESTAMPED = {
  order: () => prisma.order,
  request: () => prisma.customRequest,
  quote: () => prisma.quote,
  review: () => prisma.review,
} as const;

export async function setArchived(write: ArchiveWrite): Promise<ArchiveWriteResult> {
  const result =
    write.entity === 'product'
      ? await archiveProducts(write)
      : await archiveTimestamped(write);

  if (result.moved > 0) {
    await prisma.auditLog.create({
      data: {
        actorUserId: write.actorUserId,
        // `ActorType` has three values and no STAFF: the audit log's question
        // is "a person, the system, or a customer", and staff and admin are
        // both the first. The person is `actorUserId`.
        actorType: 'ADMIN',
        action: write.archive ? 'archive' : 'restore',
        entityType: write.entity,
        // A batch is one act. The ids are in the metadata rather than in
        // `entity_id`, which holds one row's identity by design.
        entityId: null,
        metadata: { ids: write.ids, moved: result.moved },
      },
    });
  }

  return result;
}

async function archiveTimestamped(write: ArchiveWrite): Promise<ArchiveWriteResult> {
  const delegate = TIMESTAMPED[write.entity as keyof typeof TIMESTAMPED]();

  /*
   * `updateMany` with the opposite state in the `where`.
   *
   * Archiving something already archived is not an error, but it is not a
   * change either, and the count this returns is what the screen reports. The
   * clause also makes the write idempotent under a double click.
   */
  const updated = await (
    delegate as {
      updateMany: (args: unknown) => Promise<{ count: number }>;
    }
  ).updateMany({
    where: {
      id: { in: [...write.ids] },
      archivedAt: write.archive ? null : { not: null },
    },
    data: { archivedAt: write.archive ? new Date() : null },
  });

  return { moved: updated.count, refused: [], slugs: [] };
}

/**
 * Products, through their own status.
 *
 * A published product is refused (`domain/admin/archiving`), so the rows are
 * read before they are written — the one place in this module where a rule
 * needs to see the record first.
 */
async function archiveProducts(write: ArchiveWrite): Promise<ArchiveWriteResult> {
  const products = await prisma.product.findMany({
    where: { id: { in: [...write.ids] }, deletedAt: null },
    select: { id: true, slug: true, status: true },
  });

  const refused: { id: string; reason: ArchiveRefusal }[] = [];
  const permitted: string[] = [];
  const slugs: string[] = [];

  for (const product of products) {
    if (write.archive) {
      const refusal = productArchivable(product);

      if (refusal) {
        refused.push({ id: product.id, reason: refusal });
      } else if (product.status !== 'ARCHIVED') {
        permitted.push(product.id);
        slugs.push(product.slug);
      }

      continue;
    }

    // Restoring returns it to a draft rather than to the shop. Publishing is a
    // decision with a customer-visible effect, and it has its own button.
    if (product.status === 'ARCHIVED') {
      permitted.push(product.id);
      slugs.push(product.slug);
    }
  }

  if (permitted.length === 0) return { moved: 0, refused, slugs: [] };

  const updated = await prisma.product.updateMany({
    where: { id: { in: permitted } },
    data: { status: write.archive ? 'ARCHIVED' : 'DRAFT' },
  });

  return { moved: updated.count, refused, slugs };
}

/** How many rows are currently out of the way, for the screen's own toggle. */
export async function countArchived(entity: ArchivableEntity): Promise<number> {
  if (entity === 'product') {
    return prisma.product.count({ where: { status: 'ARCHIVED', deletedAt: null } });
  }

  const delegate = TIMESTAMPED[entity as keyof typeof TIMESTAMPED]();

  return (delegate as { count: (args: unknown) => Promise<number> }).count({
    where: { archivedAt: { not: null } },
  });
}
