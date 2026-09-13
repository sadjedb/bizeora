'use server';

import { revalidatePath } from 'next/cache';

import { publishedRefusals, type ArchivableEntity } from '@/domain/admin/archiving';
import { LOCALES } from '@/i18n/locales';
import { requireStaff } from '@/server/auth/guards';
import { archiveRecords } from '@/server/services/archive-service';

/**
 * Archiving and restoring, from any of the workshop's lists.
 *
 * One action for all five kinds, because the screens differ only in which
 * table the checkboxes were ticked in. What it returns is a **code**, never a
 * sentence: the admin is bilingual (ADR-033) and the component that renders
 * the result is a client component with the dictionary already in hand, so a
 * French string baked in here would be the one untranslated thing on the page.
 *
 * **It authorises for itself.** The `/admin` layout decides what is rendered,
 * which is not the same as deciding what may run — an action is reachable
 * without any page having rendered — so this calls `requireStaff` and then the
 * service, which asks `domain/permissions` again over the loaded actor.
 */

export type ArchiveActionResult =
  | { ok: true; moved: number; archived: boolean; refusedPublished: number }
  | {
      ok: false;
      reason: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'UNKNOWN_ENTITY' | 'EMPTY' | 'TOO_MANY';
    };

export async function archiveSelectionAction(input: {
  entity: string;
  ids: readonly string[];
  archive: boolean;
}): Promise<ArchiveActionResult> {
  const authorisation = await requireStaff();

  if (!authorisation.ok) {
    return { ok: false, reason: authorisation.reason };
  }

  const result = await archiveRecords(authorisation.actor, input);
  if (!result.ok) return result;

  revalidateFor(input.entity as ArchivableEntity, result.slugs);

  return {
    ok: true,
    moved: result.outcome.moved,
    archived: input.archive,
    refusedPublished: publishedRefusals(result.outcome),
  };
}

/**
 * The screens a moved row was on.
 *
 * The admin's lists are `force-dynamic`, so they need nothing; the dashboard
 * counts the same rows and the payments screen reads orders, so both are named
 * explicitly. Products are the only kind a **visitor** can see move, and their
 * pages are cached per language — hence the loop over `LOCALES` with concrete
 * paths rather than a `/[locale]/…` pattern, which matches nothing inside a
 * route group (rule 9C).
 */
function revalidateFor(entity: ArchivableEntity, slugs: readonly string[]): void {
  revalidatePath('/admin');

  switch (entity) {
    case 'order':
      revalidatePath('/admin/orders');
      revalidatePath('/admin/payments');
      return;
    case 'request':
      revalidatePath('/admin/requests');
      return;
    case 'quote':
      revalidatePath('/admin/quotes');
      return;
    case 'review':
      revalidatePath('/admin/reviews');
      return;
    case 'product':
      revalidatePath('/admin/products');
      for (const locale of LOCALES) {
        revalidatePath(`/${locale}`);
        revalidatePath(`/${locale}/shop`);
        for (const slug of slugs) revalidatePath(`/${locale}/shop/${slug}`);
      }
      return;
  }
}
