import 'server-only';

import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id password hashing.
 *
 * Better Auth's built-in hasher is scrypt. The project requires Argon2id
 * (docs/SECURITY.md section 2), so this module is wired in through
 * `emailAndPassword.password`, which is Better Auth's supported override for
 * exactly this — no patching, no forked adapter.
 *
 * Parameters are the OWASP Password Storage Cheat Sheet's second recommended
 * Argon2id configuration: 19 MiB of memory, two iterations, one degree of
 * parallelism. Memory cost is what makes Argon2id expensive to attack on a
 * GPU, so it is the number to raise first if this ever needs strengthening.
 *
 * The encoded output carries the algorithm, version, parameters and a
 * per-password random salt, so `verify` keeps working for hashes written under
 * older parameters and these values can be raised without a migration.
 */
/**
 * `@node-rs/argon2` publishes `Algorithm` as an ambient `const enum`, which
 * `verbatimModuleSyntax` cannot import — the value would have to be inlined
 * from a declaration file that emits nothing. The numeric member is stable
 * NAPI-RS output and is asserted by test.
 */
const ARGON2ID = 2;

const ARGON2ID_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB — 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_OPTIONS);
}

/**
 * Constant-time comparison, delegated to the Argon2 implementation.
 *
 * Returns `false` rather than throwing on a malformed or unrecognised hash: a
 * corrupt stored hash must fail the login, not surface as a 500 that
 * distinguishes one account from another.
 */
export async function verifyPassword({
  hash: storedHash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  try {
    return await verify(storedHash, password, ARGON2ID_OPTIONS);
  } catch {
    return false;
  }
}
