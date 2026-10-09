'use server';

import { revalidatePath } from 'next/cache';

import { slugify } from '@/domain/catalogue';
import { mayManageCatalogue } from '@/domain/permissions';
import { LOCALES } from '@/i18n/locales';
import { requireStaff } from '@/server/auth/guards';
import {
  collectTranslation,
  integerField,
  optionalText,
  saveCategory,
} from '@/server/services/catalogue-admin-service';

import type { CategoryFormState } from './form-state';

/**
 * Writing the shelves.
 *
 * The same shape as every other admin action: authorise for itself, because the
 * layout decides what is *rendered* and a server action is reachable by anybody
 * who can POST to it; parse the form into a draft; hand it to the service; turn
 * a refusal into a message beside the field that caused it.
 */

const UNAUTHENTICATED = 'Connectez-vous pour gérer le catalogue.';
const FORBIDDEN = 'Vous n’avez pas accès à la gestion du catalogue.';

async function authorise(): Promise<{ ok: true } | { ok: false; message: string }> {
  const authorisation = await requireStaff();

  if (!authorisation.ok) {
    return {
      ok: false,
      message: authorisation.reason === 'UNAUTHENTICATED' ? UNAUTHENTICATED : FORBIDDEN,
    };
  }

  if (!mayManageCatalogue(authorisation.actor)) return { ok: false, message: FORBIDDEN };

  return { ok: true };
}

export async function saveCategoryAction(
  _previous: CategoryFormState,
  form: FormData,
): Promise<CategoryFormState> {
  const authorisation = await authorise();
  if (!authorisation.ok) return { errors: { form: authorisation.message } };

  const categoryId = optionalText(form.get('categoryId'));
  const name = (form.get('name') as string | null) ?? '';

  // An empty slug means "derive one from the name", which is what somebody
  // creating a category expects. A slug that was typed is never overwritten,
  // only normalised.
  const typedSlug = optionalText(form.get('slug'));
  const slug = typedSlug === null ? slugify(name) : slugify(typedSlug);

  const result = await saveCategory({
    categoryId,
    translation: {
      locale: 'en',
      values: collectTranslation(form, 'en', 'category'),
    },
    draft: {
      name,
      slug,
      description: optionalText(form.get('description')),
      position: integerField(form.get('position')),
      isActive: form.get('isActive') === 'on' || form.get('isActive') === 'true',
      seoTitle: optionalText(form.get('seoTitle')),
      seoDescription: optionalText(form.get('seoDescription')),
    },
  });

  if (!result.ok) {
    return { errors: result.errors, translationErrors: result.translationErrors };
  }

  /*
   * What a category change actually reaches.
   *
   * `/shop` and `/shop/c/<slug>` render per request since Phase 14.13 — they
   * read `searchParams` — so there is nothing cached to clear there. The
   * homepage is still ISR and carries the navigation, and the admin's own list
   * is `force-dynamic` but its path is revalidated anyway so a redirect back to
   * it never shows the row as it was. The old address is included because a
   * renamed category leaves one behind.
   */
  revalidatePath('/admin/categories');
  revalidatePath('/admin/products');

  for (const locale of LOCALES) {
    revalidatePath(`/${locale}`);
  }

  return { errors: {}, savedId: result.value.id, savedAt: Date.now() };
}
