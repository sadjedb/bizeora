import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth/config';

/**
 * Better Auth's endpoints, mounted at `/api/auth/*`.
 *
 * This is the only place the Better Auth instance is exposed to the framework.
 * It is a catch-all by design — sign-in, sign-out, sign-up, verify-email,
 * reset-password and the session endpoint are all served from here, and the
 * library owns their routing.
 *
 * The handler must run on the Node.js runtime: password hashing is Argon2id
 * through a native module, which the Edge runtime cannot load.
 */
export const runtime = 'nodejs';

export const { GET, POST } = toNextJsHandler(auth);
