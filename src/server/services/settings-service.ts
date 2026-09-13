import 'server-only';

import { cache } from 'react';

import { prisma } from '@/lib/db/client';
import { booleanSetting, validateSettings, type SettingRefusal } from '@/domain/settings';
import { mayManageSettings } from '@/domain/permissions';
import type { AuthenticatedActor } from '@/domain/auth/actor';
import {
  listEditableSettings,
  saveSettings,
  type AdminSettingRow,
} from '@/server/repositories/settings-admin-repository';

/**
 * The settings screen's use cases, and the runtime reads that depend on them.
 *
 * Two halves that belong together. The first is the obvious one: list what may
 * be changed, accept a form, refuse what is out of range. The second is the
 * half that makes the switches mean anything — `siteSettings()`, which every
 * request on the public site consults to know whether the shop is open and
 * whether an unverified address may commit to anything.
 *
 * They share a module because they answer the same question from the same four
 * rows: what the shop is called, whether it is open, and whether an address has
 * to be confirmed. The screen writes them; the site reads them on every
 * request.
 */

export type SettingsFailure =
  | { ok: false; reason: 'FORBIDDEN' }
  | { ok: false; reason: 'INVALID'; refusals: Readonly<Record<string, SettingRefusal>> };

export type SettingsResult = { ok: true; changed: readonly string[] } | SettingsFailure;

export async function editableSettings(): Promise<readonly AdminSettingRow[]> {
  return listEditableSettings();
}

/**
 * Accept a settings form.
 *
 * Authorises, validates every field, and writes only what changed. The
 * validation is the domain's, run again here over whatever the browser sent —
 * the screen disables an out-of-range save, and a disabled button is a courtesy
 * rather than a rule.
 */
export async function updateSettings(
  actor: AuthenticatedActor,
  values: Readonly<Record<string, string>>,
): Promise<SettingsResult> {
  if (!mayManageSettings(actor)) return { ok: false, reason: 'FORBIDDEN' };

  const refusals = validateSettings(values);
  if (Object.keys(refusals).length > 0) {
    return { ok: false, reason: 'INVALID', refusals };
  }

  const trimmed = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value.trim()]),
  );

  const saved = await saveSettings({ values: trimmed, actorUserId: actor.userId });

  /*
   * Nothing to invalidate here on purpose — see `siteSettings` below. The row
   * is the only copy, so writing it is the whole of publishing it; the next
   * request reads the new value because it reads the table. The action calls
   * `revalidatePath` for the pages whose *other* data is cached.
   */

  return { ok: true, changed: saved.changed };
}

/* ---------------------------------------------------------------------------
 * What the public site needs to know
 * ------------------------------------------------------------------------ */

export type SiteSettings = {
  /** What the shop calls itself. Overrides `config/brand.ts` at runtime. */
  brandName: string;
  /** False closes the storefront to everybody but staff. */
  storefrontEnabled: boolean;
  /** False treats every signed-in customer as verified. */
  emailVerificationRequired: boolean;
  whatsapp: string | null;
};

const KEYS = [
  'brand.name',
  'site.storefrontEnabled',
  'accounts.emailVerificationRequired',
  'contact.whatsapp',
] as const;

/**
 * What the shop is called, whether it is open, and to whom.
 *
 * Read **once per request**, and no further than that. `cache()` is React's
 * request-scoped memo: the layout asks, `generateMetadata` asks again, and a
 * page below may ask a third time — that is one query, and the three answers
 * agree with each other, which for a switch that decides whether the layout
 * renders a shop or a curtain is not a detail.
 *
 * It is deliberately **not** a cross-request cache, and two earlier attempts to
 * make it one are why. A five-second timer made the query cheap and left a
 * five-second window in which a closed shop was still selling. A cache tag
 * fixed that window and opened a worse one: the entry then lived until
 * something invalidated it, so any change that did not go through the settings
 * screen — the seed, a migration, a hand-written `UPDATE` — never arrived at
 * all, and the running site disagreed with its own database indefinitely.
 *
 * Neither was buying anything, either, which is the part worth remembering. The
 * pages where a repeated query would actually cost something are the catalogue
 * and the front page, and those are not re-rendered per request at all: they
 * are prerendered and revalidated every five minutes, so the settings query
 * runs once per regeneration whatever this function does. On the pages that
 * *are* dynamic — the cart, the account, sign-in — four rows read on a primary
 * key is the cheapest query in the request. Caching it across requests bought
 * nothing and cost the one property the switch has to have.
 */
export const siteSettings = cache(async (): Promise<SiteSettings> => buildSiteSettings());

async function buildSiteSettings(): Promise<SiteSettings> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [...KEYS] } },
    select: { key: true, value: true },
  });

  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const whatsapp = byKey.get('contact.whatsapp')?.trim() ?? '';

  const value: SiteSettings = {
    // Falls back to the compiled brand rather than to an empty title. The
    // setting is an override, not the only source (`config/brand.ts`).
    brandName: byKey.get('brand.name')?.trim() || BRAND_FALLBACK,
    /*
     * Both default to `true`, and that direction matters.
     *
     * A missing row means a database that has not been seeded, not a decision.
     * Defaulting the other way would close a working shop, or switch a security
     * control off, because somebody forgot to run the seed.
     */
    storefrontEnabled: booleanSetting(byKey.get('site.storefrontEnabled'), true),
    emailVerificationRequired: booleanSetting(
      byKey.get('accounts.emailVerificationRequired'),
      true,
    ),
    whatsapp: whatsapp === '' ? null : whatsapp,
  };

  return value;
}

/**
 * The name to fall back to.
 *
 * Imported lazily-by-value rather than from `config/brand` to keep this module
 * free of a client-side import chain; the constant is the same one.
 */
const BRAND_FALLBACK = 'Bizeora';
