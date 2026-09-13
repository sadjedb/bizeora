'use server';

import { revalidatePath } from 'next/cache';

import { mayManageSettings } from '@/domain/permissions';
import type { SettingRefusal } from '@/domain/settings';
import { requireStaff } from '@/server/auth/guards';
import { updateSettings } from '@/server/services/settings-service';

/**
 * Saving the shop's settings.
 *
 * **It authorises for itself**, like every other action here: the `/admin`
 * layout decides what is rendered, which is not the same as deciding what may
 * run. Settings are admin-only (12.1), so `requireStaff` is the door and
 * `mayManageSettings` is the lock — a member of staff can reach this screen's
 * URL and cannot write through it.
 *
 * The refusals come back keyed by setting so the screen can mark every bad
 * field at once. A settings form that reveals one problem per save is a form
 * that takes six saves.
 */

export type SettingsActionResult =
  | { ok: true; changed: readonly string[] }
  | { ok: false; reason: 'FORBIDDEN' }
  | { ok: false; reason: 'INVALID'; refusals: Readonly<Record<string, SettingRefusal>> };

export async function saveSettingsAction(
  values: Readonly<Record<string, string>>,
): Promise<SettingsActionResult> {
  const authorisation = await requireStaff();
  if (!authorisation.ok) return { ok: false, reason: 'FORBIDDEN' };
  if (!mayManageSettings(authorisation.actor)) return { ok: false, reason: 'FORBIDDEN' };

  const result = await updateSettings(authorisation.actor, values);
  if (!result.ok) return result;

  revalidatePath('/admin/settings');

  /*
   * The whole storefront, both languages, in one call.
   *
   * Almost everything on this screen changes what a **visitor** sees: the brand
   * name is in every page's title, the response-time promise is printed on the
   * front page and in the builder, and the storefront switch decides whether
   * there is a page at all. Three of those pages are cached (`/fr`, `/fr/shop`
   * and `/fr/custom` carry `revalidate = 300`, and the same in English), so
   * without this a closed shop keeps selling for five minutes.
   *
   * **The route group is part of the path**, and leaving it out is why an
   * earlier version of this did nothing at all. A cached entry is invalidated
   * by the implicit tags it was stored with, and those are built from the
   * route's internal name — `_N_T_/(site)/[locale]/layout` here, which every
   * storefront page carries. `/fr` with the `'layout'` type looks like the
   * concrete form rule 9C asks for and produces `_N_T_/(site)/fr/layout`, a tag
   * nothing has ever been stored under; it fails silently, which is the whole
   * hazard rule 9C is about.
   *
   * Naming the layout rather than each page is deliberate: a page added under
   * it tomorrow is covered by this call on the day it is written, where a list
   * of paths would quietly stop being complete.
   */
  revalidatePath('/(site)/[locale]', 'layout');

  return { ok: true, changed: result.changed };
}
