import 'server-only';

import {
  isArchivableEntity,
  validateSelection,
  type ArchivableEntity,
  type ArchiveOutcome,
  type SelectionRefusal,
} from '@/domain/admin/archiving';
import { mayArchiveRecords } from '@/domain/permissions';
import type { AuthenticatedActor } from '@/domain/auth/actor';
import { countArchived, setArchived } from '@/server/repositories/archive-repository';

/**
 * Archiving, as the workshop's screens ask for it.
 *
 * The screens send strings — an entity name out of a URL, a list of ids out of
 * checkboxes — and this is where a string becomes a permitted operation on a
 * known kind of row. Three questions in order, and the order is the point:
 *
 *   1. **may this person do it** (`domain/permissions`), before anything else
 *      is read;
 *   2. **is this a kind of row that can be archived** — the entity arrives from
 *      the client, so it is never trusted as a Prisma delegate name;
 *   3. **is the selection sane** — not empty, not longer than any sequence of
 *      clicks could have produced.
 *
 * Only then does the repository see it. The refusals are values rather than
 * exceptions because every one of them is something the screen has to say to
 * somebody in their own language.
 */

export type ArchiveRequest = {
  /** As it arrives from the form: unvalidated. */
  entity: string;
  ids: readonly string[];
  /** `true` archives, `false` restores. */
  archive: boolean;
};

export type ArchiveFailure =
  | { ok: false; reason: 'FORBIDDEN' }
  | { ok: false; reason: 'UNKNOWN_ENTITY' }
  | { ok: false; reason: SelectionRefusal };

export type ArchiveSuccess = {
  ok: true;
  outcome: ArchiveOutcome;
  /** Storefront slugs the caller has to invalidate; empty for the four queues. */
  slugs: readonly string[];
};

export type ArchiveResult = ArchiveSuccess | ArchiveFailure;

export async function archiveRecords(
  actor: AuthenticatedActor,
  request: ArchiveRequest,
): Promise<ArchiveResult> {
  if (!mayArchiveRecords(actor)) return { ok: false, reason: 'FORBIDDEN' };

  if (!isArchivableEntity(request.entity)) {
    return { ok: false, reason: 'UNKNOWN_ENTITY' };
  }

  // Duplicates in the payload are a client artefact, not an intent: a person
  // cannot tick the same box twice, and counting one row twice against the
  // batch limit would refuse a selection they could see was small enough.
  const ids = [...new Set(request.ids.map((id) => id.trim()).filter(Boolean))];

  const refusal = validateSelection(ids);
  if (refusal) return { ok: false, reason: refusal };

  const { slugs, ...outcome } = await setArchived({
    entity: request.entity,
    ids,
    actorUserId: actor.userId,
    archive: request.archive,
  });

  return { ok: true, outcome, slugs };
}

/**
 * How many rows are put away, for the toggle that opens the other half.
 *
 * The screens ask for this on every render rather than caching it: it is one
 * indexed count, and a stale "Archived (3)" beside a list of four is the kind
 * of small lie that makes an operator stop trusting the screen.
 */
export async function archivedCount(entity: ArchivableEntity): Promise<number> {
  return countArchived(entity);
}
