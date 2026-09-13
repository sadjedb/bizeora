/**
 * Result — the domain layer's error-handling primitive.
 *
 * Domain functions return a Result rather than throwing, so every failure a
 * caller must handle is visible in the type (docs/ARCHITECTURE.md section 14).
 * Exceptions remain for genuinely unexpected conditions.
 *
 * This module is deliberately free of business meaning. Concrete error codes
 * (OUT_OF_STOCK, QUOTE_EXPIRED, INVALID_TRANSITION, ...) are declared by the
 * phase that first needs them, not here.
 *
 * Like everything under src/domain, this file imports nothing: no Next.js, no
 * Prisma, no infrastructure, no browser API. The ESLint boundary rules in
 * eslint.config.mjs enforce that.
 */

export interface DomainError {
  readonly code: string;
}

export type Result<T, E extends DomainError = DomainError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends DomainError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E extends DomainError>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

export function isErr<T, E extends DomainError>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/**
 * Applies `fn` to a successful value, passing failures through untouched.
 */
export function map<T, U, E extends DomainError>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Chains an operation that may itself fail, so a sequence of fallible steps
 * short-circuits on the first error.
 */
export function flatMap<T, U, E extends DomainError, F extends DomainError>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>,
): Result<U, E | F> {
  return result.ok ? fn(result.value) : result;
}

/**
 * Unwraps a successful value or returns the fallback. Never throws.
 */
export function unwrapOr<T, E extends DomainError>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
