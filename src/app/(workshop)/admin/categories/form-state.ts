import type { CategoryFormErrors } from '@/server/services/catalogue-admin-service';

/**
 * What the category form passes back.
 *
 * Here rather than in `actions.ts` for the reason the product form's state
 * module already records: a `'use server'` module may only export async
 * functions, so a constant exported from one is not the constant the client
 * imported — it builds, and then fails at runtime with the value missing.
 */
export type CategoryFormState = {
  errors: CategoryFormErrors;
  /** Keyed by translated field, so the English panel marks its own boxes. */
  translationErrors?: Record<string, string>;
  /** Set on success so the client can navigate to the saved category. */
  savedId?: string;
  /*
   * A new value on every successful save.
   *
   * `savedId` is the same string each time, so an effect watching it fires
   * once and never again — which is why editing a record twice used to give
   * feedback only the first time. This changes, so each save is its own event.
   */
  savedAt?: number;
};

export const EMPTY_CATEGORY_FORM_STATE: CategoryFormState = { errors: {} };
