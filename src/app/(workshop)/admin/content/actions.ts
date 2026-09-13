'use server';

import { revalidatePath } from 'next/cache';

import { mayManageContent } from '@/domain/permissions';
import { LOCALES } from '@/i18n/locales';
import { requireStaff } from '@/server/auth/guards';
import { attachSiteImage } from '@/server/services/media-service';
import {
  moveSection,
  removeBanner,
  saveBanner,
  saveSection,
  toggleSection,
  type SectionSubmission,
} from '@/server/services/content-admin-service';

/**
 * Writing the front page.
 *
 * Every action authorises independently — the layout guards what renders, and
 * a server action is reachable by anybody who can POST to it — and every one
 * of them revalidates the homepage afterwards.
 *
 * That last part is the whole point of the screen. The homepage is cached for
 * five minutes (`revalidate = 300`), so an edit that did not invalidate it
 * would appear to do nothing for five minutes and then appear to work, which is
 * the most confusing possible behaviour for a person changing a headline.
 */

const UNAUTHENTICATED = 'Connectez-vous pour modifier le contenu.';
const FORBIDDEN = 'Vous n’avez pas accès à la gestion du contenu.';

export type ContentResult = { ok: true } | { ok: false; message: string };

async function authorise(): Promise<{ ok: true } | { ok: false; message: string }> {
  const authorisation = await requireStaff();

  if (!authorisation.ok) {
    return {
      ok: false,
      message: authorisation.reason === 'UNAUTHENTICATED' ? UNAUTHENTICATED : FORBIDDEN,
    };
  }

  if (!mayManageContent(authorisation.actor)) return { ok: false, message: FORBIDDEN };

  return { ok: true };
}

/**
 * The homepage in both languages, plus the admin screen itself.
 *
 * **Concrete paths, one per language.** The route-pattern form —
 * `revalidatePath('/[locale]', 'page')` — is the documented way to invalidate
 * every parameter of a dynamic route at once, and it does not reach this page:
 * the storefront lives inside two route groups, and the pattern that would
 * match is not the URL. `/fr` and `/en` are what the cache is keyed on, they
 * are what a visitor asks for, and there are two of them.
 *
 * Getting this wrong is quiet in exactly the wrong way: the write succeeds, the
 * screen says so, and the front page keeps its old copy for five minutes.
 */
function revalidateHome(): void {
  for (const locale of LOCALES) revalidatePath(`/${locale}`);
  revalidatePath('/admin/content');
}

/** French messages for the domain's refusal codes. */
const MESSAGES: Record<string, string> = {
  NOT_FOUND: 'Cette section n’existe plus. Rechargez la page.',
  TITLE_TOO_LONG: 'Le titre est trop long.',
  SUBTITLE_TOO_LONG: 'Le sous-titre est trop long.',
  BODY_TOO_LONG: 'Le texte est trop long.',
  CTA_TOO_LONG: 'Le libellé du bouton est trop long.',
  CTA_INCOMPLETE: 'Un bouton a besoin d’un libellé et d’une destination.',
  HREF_NOT_INTERNAL: 'La destination doit être une page du site, comme /shop.',
  UNKNOWN_FIELD: 'Un champ inconnu a été soumis. Rechargez la page.',
  COUNT_INVALID: 'Le nombre doit être un entier positif.',
  COUNT_TOO_LARGE: 'Ce nombre dépasse le maximum autorisé.',
  FLAG_INVALID: 'Valeur invalide.',
  POINTS_INVALID: 'Trop de points, ou format invalide.',
  TEXT_INVALID: 'Valeur invalide.',
  TEXT_TOO_LONG: 'Ce texte est trop long.',
  MESSAGE_EMPTY: 'Le message ne peut pas être vide.',
  MESSAGE_TOO_LONG: 'Le message est trop long.',
};

function message(code: string | undefined): string {
  return code ? (MESSAGES[code] ?? 'Modification refusée.') : 'Modification refusée.';
}

export async function saveSectionAction(
  input: SectionSubmission,
): Promise<ContentResult> {
  const permitted = await authorise();
  if (!permitted.ok) return permitted;

  const result = await saveSection(input);

  if (!result.ok) {
    const first = Object.values(result.errors)[0];
    return { ok: false, message: message(first) };
  }

  revalidateHome();
  return { ok: true };
}

export async function toggleSectionAction(input: {
  sectionId: string;
  isEnabled: boolean;
}): Promise<ContentResult> {
  const permitted = await authorise();
  if (!permitted.ok) return permitted;

  const result = await toggleSection(input);
  if (!result.ok) return { ok: false, message: message('NOT_FOUND') };

  revalidateHome();
  return { ok: true };
}

export async function moveSectionAction(input: {
  sectionId: string;
  direction: 'up' | 'down';
}): Promise<ContentResult> {
  const permitted = await authorise();
  if (!permitted.ok) return permitted;

  const result = await moveSection(input);
  if (!result.ok) return { ok: false, message: message('NOT_FOUND') };

  revalidateHome();
  return { ok: true };
}

export async function saveBannerAction(input: {
  bannerId: string | null;
  message: string;
  href: string | null;
  isActive: boolean;
}): Promise<ContentResult> {
  const permitted = await authorise();
  if (!permitted.ok) return permitted;

  const result = await saveBanner(input);
  if (!result.ok) return { ok: false, message: message(result.code) };

  revalidateHome();
  return { ok: true };
}

export async function deleteBannerAction(input: {
  bannerId: string;
}): Promise<ContentResult> {
  const permitted = await authorise();
  if (!permitted.ok) return permitted;

  await removeBanner(input.bannerId);
  revalidateHome();

  return { ok: true };
}

/**
 * Upload an image for a band — the hero, today.
 *
 * Returns the **storage key** rather than a URL, because that is what the row
 * stores: a URL would bake today's origin into the database, and moving the
 * public assets to a CDN would rewrite every row that mentioned it.
 */
export async function uploadSiteImageAction(
  form: FormData,
): Promise<{ ok: true; storageKey: string } | { ok: false; message: string }> {
  const permitted = await authorise();
  if (!permitted.ok) return permitted;

  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, message: 'Envoi incomplet.' };

  const result = await attachSiteImage({
    bytes: new Uint8Array(await file.arrayBuffer()),
    contentType: file.type,
  });

  if (!result.ok) return { ok: false, message: result.message };

  return { ok: true, storageKey: result.value.storageKey };
}
