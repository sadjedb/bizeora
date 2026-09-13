import type {
  ProductFormErrors,
  VariantFormErrors,
} from '@/server/services/catalogue-admin-service';

/**
 * The shapes the catalogue forms pass back and forth.
 *
 * They live here rather than beside the actions because a `'use server'` module
 * may only export async functions: Next turns every export into a callable
 * server reference, so a plain object exported from `actions.ts` is not the
 * object the client imported. It builds, and then the page fails at runtime
 * with the constant missing — which is exactly how this file came to exist.
 */

export type ProductFormState = {
  errors: ProductFormErrors;
  /** Set on success so the client can navigate to the saved product. */
  savedId?: string;
};

export const EMPTY_PRODUCT_FORM_STATE: ProductFormState = { errors: {} };

export type OptionFormState = { errors: { name?: string; values?: string } };

export const EMPTY_OPTION_FORM_STATE: OptionFormState = { errors: {} };

export type VariantFormState = { errors: VariantFormErrors; saved?: boolean };

export const EMPTY_VARIANT_FORM_STATE: VariantFormState = { errors: {} };
