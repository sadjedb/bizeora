# SECURITY.md

> The security architecture for Bizeora. Enforcement points are in `ARCHITECTURE.md`.
> Ownership classification is in `DATABASE.md` section 15.

---

## 1. Threat Model

What actually matters for this application, in priority order.

| Asset                                            | Threat                                                       | Impact                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Customer design files**                        | A competitor or stranger downloads a business's logo artwork | Highest. Breaks the core trust promise and is commercially damaging to the customer |
| **Customer PII** (phone, address, order history) | Enumeration or a broken access control                       | High. Phone numbers and home addresses in a market where COD means real deliveries  |
| **Admin access**                                 | Credential compromise, privilege escalation                  | High. Full catalogue, pricing and customer data                                     |
| **Order and quote integrity**                    | Client-side price tampering, forced status transitions       | High. Direct financial loss                                                         |
| **Availability**                                 | Upload flooding, request spam                                | Medium. Storage cost and an unusable admin queue                                    |
| **Reputation**                                   | Stored XSS through an uploaded SVG or a review               | High. Site-wide compromise from a single file                                       |

The two failure modes that would genuinely damage the business: **a leaked customer design file**
and **an order placed at a price the customer chose**. Everything below is weighted accordingly.

### Baseline principles

1. Never trust the client. Not the price, not the total, not the status, not the content type, not
   the file extension, not the user ID.
2. Authorisation is enforced in the data-access layer, so it cannot be forgotten in a page.
3. Fail closed. An unknown state denies.
4. Do not confirm the existence of a resource to someone not entitled to it.
5. Log what matters — file access, PII access, status changes, auth events.

---

## 2. Authentication

**Better Auth 1.7.2 with database-backed sessions.** See `DECISIONS.md` ADR-006, ADR-019, ADR-020
and ADR-021. Implemented in Phase 3; the table below describes the configuration that actually ships,
in `src/lib/auth/config.ts`.

| Control            | Implementation                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Password hashing   | **Argon2id** via `@node-rs/argon2`, wired through `emailAndPassword.password` — Better Auth's supported override for its default scrypt. OWASP parameters: 19 MiB memory, 2 iterations, parallelism 1, per-password salt. Never MD5, SHA-\*, or bcrypt with a low cost |
| Password storage   | The hash lives on the credential account row — `accounts.password` where `providerId = 'credential'` and `issuer = 'local:credential'`. There is no `users.passwordHash`; one hash, one place |
| Password policy    | Minimum 10 characters, maximum 256. No composition rules — they produce worse passwords. A common-password list is **not yet implemented**; it belongs with the registration UI |
| Session token      | 32 characters from a 62-character alphabet over `crypto.getRandomValues` with rejection sampling — **≈190 bits** of entropy. **Stored as issued** in `sessions.token`. See section 2.1 |
| Session cookie     | The cookie carries `<token>.<signature>`; a value whose HMAC does not verify is rejected before any database lookup                             |
| Session lifetime   | Customer 30 days; staff and admin 7 days, clamped at creation and again as an absolute cap on `sessions.createdAt`. Rolling refresh at 24 hours |
| Session revocation | Deleting the row ends the session immediately. This is why sessions are not JWTs                                                               |
| Session rotation   | A new session token is issued on login; `revokeSessionsOnPasswordReset` deletes every session on a password reset                              |
| Email verification | **8-digit one-time code** (`emailOTP` plugin), 15-minute expiry, **single-use**, 3 attempts, encrypted at rest. Required before accepting a quote, not before browsing. See section 2.1 and ADR-021 |
| Password reset     | Single-use token in `verification`, **SHA-256 hashed at rest**, 1-hour expiry, consumed atomically on use. The response is identical whether or not the address exists |
| Login throttling   | **Implemented in Phase 15.** 5 attempts per identifier and 20 per address, each per 15 minutes, counted before the password is checked. See section 9 |
| Enumeration        | Registration answers a duplicate address with a synthetic user, a null token and no email, and hashes the submitted password anyway so the timing matches. Reset answers identically for an unknown address |
| Admin accounts     | Provisioned by seed or by an existing admin. No public admin registration route exists                                                          |
| Authorisation      | **Not Better Auth's.** `users.role` is our column, every decision is a pure function in `domain/permissions`, and no Better Auth type leaves `lib/auth/` |

Phone is stored and normalised to E.164 but is not an authentication factor in V1. OTP login is a
V2 option; the schema does not preclude it.

**Not in V1**: two-factor authentication. It is the first thing to add for admin accounts in V1.5,
and `users` has room for it without a migration.

### 2.1 Token storage at rest: what is protected how, and why

Phase 2.3 accepted plaintext storage for session **and** verification tokens, believing that
hashing either would require rewriting reads and writes underneath Better Auth. Phase 3 installed
the package and read it; that belief held for sessions and not for the rest. Phase 3.1 then
replaced the verification link entirely. The three credentials are therefore handled differently,
and the differences follow the library's mechanisms rather than a change of heart. See ADR-020 and
ADR-021.

| Credential               | At rest                                                   | Expiry     | Single use                                          |
| ------------------------ | --------------------------------------------------------- | ---------- | --------------------------------------------------- |
| Session token            | **Plaintext** in `sessions.token`. Accepted trade-off      | 30d / 7d   | n/a — valid until expiry or deletion                |
| Password-reset token     | **SHA-256 hashed** in `verification.identifier`            | 1 hour     | Yes, atomically — the row is deleted as it is read  |
| Email-verification code  | **Encrypted** in `verification.value`, identifier hashed   | 15 minutes | Yes, atomically, plus a 3-attempt budget            |

#### Email verification — an 8-digit single-use code

Better Auth's *default* verification link is a stateless HS256 JWT: nothing is stored, so nothing
can be consumed, and the link verifies the address as often as it is presented until it expires.
That is not acceptable for a credential that gates quote acceptance, so it is not what ships.

Verification uses the `emailOTP` plugin with `overrideDefaultEmailVerification: true` — the
library's own switch for this substitution. What that buys, each of it covered by a test:

- **Single use.** `atomicVerifyOTP` consumes the row through `consumeVerificationValue`, which
  deletes it in the same operation that reads it, and does not recreate it on success.
- **Replay rejection.** A second presentation of the same code finds no row and is refused. The
  address stays verified once; no session is minted and no state changes.
- **Expiry.** 15 minutes, enforced, with expired rows deleted on sight.
- **Attempt limit.** Three wrong codes and the row is left consumed rather than recreated, which
  locks the identifier out — even the correct code is then refused. This, not the code's length,
  is the anti-guessing control.
- **Request flooding.** `rateLimit: { window: 60, max: 3 }` on the send endpoint, where Better
  Auth's rate limiting is active — production by default.

**The code is encrypted at rest, not hashed, and that is deliberate.** An 8-digit code carries
about 27 bits of entropy: anyone holding a SHA-256 digest of it recovers the code by trying all
10^8 candidates, which is milliseconds of work. Hashing a low-entropy credential looks like
protection and is not. Symmetric encryption under `BETTER_AUTH_SECRET` is, because the secret lives
in the secret store rather than the database. The identifier — `email-verification-otp-<address>` —
is hashed by the setting below, so the table does not carry the address either.

One residual, stated rather than buried: Better Auth's core `/verify-email` endpoint stays mounted,
because it is part of the library's route set. Nothing in the application issues a token for it any
more, so obtaining a valid one requires `BETTER_AUTH_SECRET`, which is already total compromise. A
test asserts that sign-up hands out a code and no link, and that an invalid token verifies nobody.

#### Password reset — hashed, because a supported option exists

A reset token lives in `verification.identifier` as `reset-password:<token>`, and
`verification.storeIdentifier: "hashed"` is Better Auth's own configuration value: it SHA-256s the
identifier on write and applies the same transformation on lookup. This is a documented option, not
an adapter rewrite, so it is enabled. A `verification` row is not a usable credential.

Hashing works here precisely where it fails for the OTP: the token is 24 characters over a
62-character alphabet, roughly 143 bits, so the digest is irreversible in practice.

Consumption is `consumeVerificationValue`, which deletes the row inside the operation that reads
it. That is what makes single use real rather than a two-step read-then-delete with a race in the
middle.

#### Session tokens — plaintext, and this is the accepted trade-off

Better Auth looks a session up by equality on the raw `sessions.token`. There is no supported
option to change that, and the Phase 2.3 reasoning stands in full.

Stated plainly rather than dressed up: **an attacker with read access to the `sessions` table can
impersonate any logged-in user without knowing a password.** With hashed tokens, database read
access alone would not be enough. This is not more secure and it is not ideal; it is the cost of
using the library's supported model.

Why it is accepted anyway:

- **The alternative is an unsupported adapter.** Hashing would mean rewriting reads and writes
  underneath Better Auth so the library believes it is comparing a raw value while the adapter
  compares a digest. It would break on any release that changes how sessions are queried, and it
  would break in the hardest possible place to notice — an authentication path that keeps
  appearing to work. A home-made authentication layer that fails open is worse than a stored token
  reachable only through a database compromise. **The unsupported hashing adapter is rejected,
  deliberately.**
- **Hand-rolling authentication was rejected for the reason ADR-006 gives.** Reset, verification,
  throttling and later two-factor are each a place where a subtle mistake is expensive.
- **The compromise required to reach the token already ends the game.** Read access to `sessions`
  is read access to `orders`, `users` and `design_files`. Hashing raises the cost of one step in a
  breach that is already catastrophic; it does not prevent the breach.

#### Transactional e-mail — what the outbox is allowed to hold

The outbox (`ARCHITECTURE.md` 11) stores a `payload` as JSON in a durable table, and a durable
table is a backup, a replica and a support export. Three rules follow, and Phase 8A built to them:

- **The two credential messages are never queued.** `auth.verify_email` and `auth.password_reset`
  render and send inside the request that produced them, so no live code and no reset link is ever
  written to the database. ADR-026 records the trade-off — no delivery record for those two — and
  why it is the right way round.
- **A queued payload carries only what the recipient may read.** It is built from the snapshots the
  announcing row already holds — the order's stored totals and item names, the quote's authored
  lines — so `internalNotes`, `storageKey`, an admin URL in a customer template, and any other
  customer's data are absent by construction rather than by filtering. Tests assert this per
  template.
- **The body is never logged.** The development transport records that a message was due, with its
  subject and recipient only; the provider transport stores the HTTP status in `lastError` and not
  the provider's error body, which can quote the message it rejected.

**Recipients are resolved on the server, never accepted from a request.** A customer message goes
to the address on the row that announced it — the order's stored `contactEmail`, the quote owner's
account address. A staff message goes to the `notifications.adminRecipients` setting (with
`ADMIN_NOTIFICATION_EMAIL` as a bootstrap), so no form field can redirect the workshop's mail or
enumerate addresses through it. `domain/notification` declares each template's audience and the
enqueuing functions refuse a mismatch, so a staff template cannot leave through the customer door.

**The scheduler endpoint is not a session.** `POST /api/jobs/notifications` authenticates with the
`JOBS_SECRET` shared secret compared in constant time, refuses outright when it is unconfigured,
and is `POST` only — a `GET` that flushes the outbox is one prefetch away from sending twice. It
returns counts, never recipients or subjects, because the response goes into a scheduler's log.

#### Compensating controls, mandatory rather than optional

| Control                  | Requirement                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Token entropy            | Session token: 32 characters over a 62-character alphabet from `crypto.getRandomValues` with rejection sampling, ≈190 bits. Reset token: 24 characters, ≈143 bits. The verification code is 8 digits and relies on its attempt budget, not its length |
| Cookie signature         | The session cookie is `<token>.<signature>`. A tampered value is rejected before any database lookup               |
| Session revocation       | Row deletion, effective on the next request. Sign-out deletes the row; a password reset deletes every session for that user |
| Absolute staff cap       | Staff and admin sessions are refused and deleted once `sessions.createdAt` passes seven days, regardless of refresh |
| Credential lifetime      | Enforced: 15 minutes for email verification, 1 hour for password reset                                            |
| Single use               | Real for both flows in `verification`, through atomic delete-on-read                                              |
| Transport                | HTTPS everywhere; HSTS. A credential is never placed in a URL we log, and never in a query string we generate      |
| Cookie flags             | `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, host-only — see section 8                           |
| Database exposure        | The database is **never publicly reachable**. Private networking or IP allow-listing, TLS in transit, credentials in the secret store, no shared or checked-in credentials, least-privilege application role |
| Backups                  | Encrypted at rest and access-controlled, because a backup contains live session tokens                            |
| Logging                  | `sessions.token`, `verification.value`, `verification.identifier` and `accounts.password` are never logged and never serialised into a DTO — the same never-serialise rule as `internalNotes` and `storageKey` (section 10). The email seam treats both `url` and `otp` as credentials and writes neither, and Better Auth's own logger is pinned to `warn`, because it reports sign-up attempts with the email address at `info` |
| Passwords are unaffected | Argon2id hashing is untouched by any of this. A database read does not yield passwords                            |

**Open for the security review**, in the order they are worth arguing about:

1. **Login throttling**, specified in section 9 and not yet built; until Phase 15 there is no
   brute-force limit on the sign-in endpoint. This is now the weakest item on this page.
2. **Session lifetimes** below the current 30-day customer / 7-day admin figures, which is the
   cheapest remaining way to cut the window in which a stolen session token is useful.

---

## 3. Authorisation

Three roles: `CUSTOMER`, `STAFF`, `ADMIN`. The full capability matrix is in
`BUSINESS-RULES.md` section 12.

### Three enforcement layers

**1. Middleware — routing only.** Redirects unauthenticated requests away from `/account` and
non-staff away from `/admin`. This is a UX convenience. It is **never** relied upon as the
security boundary, because middleware does not cover every data path and a matcher mistake would
silently expose everything.

**2. Action and route wrappers — the real boundary.** Every server action and route handler is
built from one of `publicAction`, `customerAction` or `adminAction`. The wrapper resolves the
session, asserts the role, and constructs a typed actor:

```ts
type Actor =
  | { kind: 'anonymous' }
  | { kind: 'customer'; userId: string }
  | { kind: 'staff'; userId: string; role: 'STAFF' | 'ADMIN' };
```

There is no path to a service that does not carry an actor.

**3. Repositories — ownership scoping.** Customer-scoped repository functions require a
`CustomerActor` and put `userId` **into the query**. A `StaffActor` can only be constructed by
`adminAction`. This makes an ownership check a type-level requirement rather than something a
reviewer has to notice.

### Rules

- Hiding a control in the UI is presentation. It is never protection.
- Permission predicates are pure functions in `domain/permissions`, unit tested, used identically
  by the wrapper and by the UI that decides whether to render a control.
- Role checks are explicit per capability. Roles are not treated as a hierarchy in code, so a new
  role cannot silently inherit permissions.

---

## 4. Resource Ownership and IDOR Prevention

IDOR is the most likely serious vulnerability in an application of this shape. Five defences, all
applied:

**1. Ownership in the query, never after the fetch.**

```ts
// required shape
prisma.order.findFirst({ where: { orderNumber, userId: actor.userId } })

// prohibited — one deleted line from a leak
const order = await prisma.order.findUnique({ where: { orderNumber } })
if (order.userId !== actor.userId) throw
```

**2. Non-enumerable identifiers.** UUID v7 primary keys; human references (`orderNumber`,
`quoteNumber`, `requestNumber`) are unguessable rather than sequential, and they are not the
authorisation mechanism — they are still ownership-scoped.

**3. Not-found instead of forbidden.** A request for another customer's resource returns 404.
A 403 confirms the resource exists, which is itself a leak.

**4. One-hop rules.** Child records (order items, quote items, request events, customisations)
are never queried by ID from a customer path. They are always reached through the
ownership-scoped parent.

**5. Tests.** The integration suite includes, for every customer-owned resource, a case where
customer B requests customer A's resource by identifier and must receive not-found. This is a
required test, not an optional one.

### Specific surfaces

| Surface                       | Control                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `/account/orders/[number]`    | Scoped by `userId` in the query                                                       |
| `/account/quotes/[number]`    | Scoped by `userId`; accept and reject additionally re-check                           |
| `/api/files/[id]`             | Ownership or staff role checked before a signed URL is issued; access is audit-logged. Implemented as server-side resolution rather than a route: a customer's page resolves files it owns, and the admin workspace resolves files **through the request they are attached to** — staff are not owners, so they reach artwork by the work rather than by ownership |
| `/order/confirmation/[token]` | Single-use `guestToken`, short-lived, not the order number                            |
| `/track/[orderNumber]`        | Requires the matching phone; rate-limited; returns only status data                   |
| Admin routes                  | `adminAction` wrapper plus a route-group layout check                                 |
| Cart                          | Bound to the session user or to an `HttpOnly` anonymous cookie token                  |

---

## 5. Server-Side Validation

**Every mutation is validated on the server. Client validation is a convenience with no security
value whatsoever.**

Two distinct layers, both required:

| Layer       | Tool                        | Answers                                                                                             |
| ----------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| **Shape**   | Zod, at the action boundary | Is this the right type, length, format, range?                                                      |
| **Meaning** | `domain/`, in the service   | Is this coupon usable? Is this variant in stock? Is this transition legal? Does this user own this? |

Rules:

- Unvalidated input never reaches a service. A service may assume well-formed arguments.
- **Prices, totals, discounts and shipping are never accepted from the client.** The client sends
  identifiers and quantities; the server computes money. A submitted total is ignored.
- **Status values are never accepted as arbitrary strings.** A transition request names a target;
  the state machine decides whether it is legal.
- **User and owner identifiers are never accepted from the client.** They come from the session.
- Mass assignment is impossible: Zod schemas are explicit allowlists, and no service spreads a
  request body into a Prisma write.
- SQL injection is structurally prevented by Prisma's parameterisation. Raw SQL requires review
  and parameter binding; string interpolation into `$queryRaw` is prohibited.

---

## 6. File Upload Security

> **Two pipelines since Phase 14.8, and they must not be confused.** What
> follows is the **customer** one: artwork uploaded by whoever is buying, stored
> privately, byte-for-byte, and readable only through a signed URL after an
> ownership check. The **workshop's** photography takes a different route on
> purpose — staff only, through the server, re-encoded, and written to the one
> public prefix. It is described at the end of this section, and ADR-032 records
> why the two differ.

The highest-risk surface. The full pipeline:

```
1  Client requests a presigned upload
   -> authenticate, rate-limit, validate declared type/size, check per-request file count
   -> issue a presigned PUT restricted to content-length range and a quarantine key
   -> write a DesignFile row with status PENDING

2  Client PUTs directly to the private bucket, quarantine/ prefix

3  Client notifies the completion endpoint
   -> server HEADs the object: real size
   -> server reads the leading bytes: real type by magic number
   -> extension, MIME and magic number must all agree
   -> type-specific validation (below)
   -> PNG/JPG only: generate a downscaled raster thumbnail (previewKey)
      SVG/PDF: no thumbnail is generated in V1 (ADR-011); previewKey stays null
   -> move to designs/ prefix, set status READY
   -> failure -> status REJECTED or QUARANTINED, object deleted or retained for review

4  Access only ever through a short-lived signed GET issued after an authorisation check
```

### Validation rules

| Check               | Rule                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Extension allowlist | `.png .jpg .jpeg .svg .pdf` only. Denylists are always incomplete                                                                                                                          |
| MIME allowlist      | `image/png`, `image/jpeg`, `image/svg+xml`, `application/pdf`                                                                                                                              |
| Magic number        | Verified server-side from the object's leading bytes. The client-declared content type is treated as a hint with no authority                                                              |
| Agreement           | Extension, MIME and magic number must all match, or the file is rejected                                                                                                                   |
| Size                | 25 MB per file, enforced both in the presigned policy and re-verified by a HEAD after upload. The client-side pre-check reads the same constant from `domain/design-file`, so the two cannot drift |
| Count               | 5 files per configuration, 50 MB per request, enforced server-side                                                                                                                         |
| Filename            | Never used as a storage key. The key is a generated UUID plus a derived extension. The original name is stored as data, sanitised of control characters and path separators, and truncated |
| Dimensions          | Rasters decoded with a hardened image library under an explicit pixel cap (40 MP, 12 000 px per edge) as a decompression-bomb defence. The **pixels are actually read**, not merely the header: a PNG with a valid header and a corrupt body reports its dimensions happily and fails the moment anything opens it |
| PDFs                | Page count capped; treated as opaque, never rendered server-side or inline in a browser                                                                                                    |
| Checksum            | SHA-256 recorded for integrity and deduplication                                                                                                                                           |

### SVG — treated as hostile code, because it is

An SVG is an XML document that can carry scripts, external references and entity expansions. Three
controls, all applied:

1. **Refuse on ingest** — amended by ADR-024, which supersedes the original "sanitise on ingest".
   The server detects `<script>`, `<foreignObject>`, every `on*` attribute, `<use>` or `<image>`
   with an external reference, a `javascript:` URL, `<style>` containing `@import`, and any DOCTYPE
   or entity declaration, and **rejects the file** with a reason the customer can act on. What
   passes is stored byte-for-byte as it was sent.

   The change is deliberate: V1 renders an uploaded SVG nowhere, so a rewriter buys nothing at
   render time while adding an XML parser and re-serialiser to the attack surface — and silently
   altering a customer's artwork is worse for them than being told which construct to remove.
   Controls 2 and 3 below are what the security argument rests on, and both are implemented. If
   V1.5 adds SVG thumbnails, this must be revisited before the first one is rendered.
2. **Never render inline.** An uploaded SVG is never injected into the DOM, never used as the
   source of an `<img>` on a page carrying session cookies, and never served from the application's
   origin. **V1 generates no raster preview for SVG or PDF at all** (ADR-011): both are represented
   by a file card showing name, type and size, and are downloaded to be worked with. This removes
   SVG and PDF decoding from the server entirely, so the sanitiser is a storage-integrity control
   rather than a rendering prerequisite. Should SVG thumbnails be added in V1.5, they must be
   server-generated rasters, never the original file.
3. **Serve as an attachment.** Signed downloads set
   `Content-Disposition: attachment` and `Content-Type: application/octet-stream`, with
   `X-Content-Type-Options: nosniff`. The browser saves the file; it does not execute it.

The same attachment rule applies to PDFs.

**Rationale for keeping SVG at all**: logos arrive as SVG, and refusing them would push the most
valuable customer segment back to WhatsApp. The risk is manageable; the business cost of refusing
is not.

### Malware

V1 does not run an antivirus scan. The mitigations are that files are never executed, never served
from the application origin, and only ever downloaded by the business owner. The `DesignFileStatus`
enum includes `QUARANTINED` and the pipeline has an explicit scan step, so integrating a scanner
in V1.5 is a service change with no schema change.

---

### Shop photography (Phase 14.8)

The other kind of file, governed by the opposite rules.

```
1  Staff choose a file on the product or content screen
   -> the server action authorises: requireStaff, then the capability predicate
   -> declared type and size checked (domain/media)

2  The bytes arrive in the action's own body — no presigned PUT
   -> the file's own signature is checked: PNG, JPEG or WebP, nothing else
   -> sharp decodes it under a pixel-count limit (decompression bombs)
   -> EXIF orientation applied, then ALL metadata dropped
   -> longest edge capped at 2400px, transparency flattened, re-encoded as JPEG

3  Only now is the object written, to the media/ prefix
   -> key is a generated UUID plus a derived extension, as everywhere else
   -> the row (product image) or the config key (hero) is written after it

4  Served without a signature, to anyone
   -> app/assets/[...path] streams it with a one-year immutable cache, or a CDN
      does when NEXT_PUBLIC_PUBLIC_ASSET_URL points at one
   -> the route serves the media/ prefix and nothing else: designs/ and
      previews/ are not reachable through it, by whitelist
```

Three properties are load-bearing:

- **Nothing is written publicly before it has been decoded.** "Verify
  afterwards" is fine for a private bucket and wrong for a public one: between
  the write and the check, the object is already readable.
- **The stored bytes are not the uploaded bytes.** A phone writes GPS
  coordinates into every photograph it takes; publishing them beside a product
  picture is a privacy failure nobody would notice until it mattered. The
  integration test asserts the two differ.
- **The public route is a whitelist, not a filter.** `isPublicMediaKey` accepts
  the `media/` prefix and refuses everything else, and an unknown path is a 404
  rather than a 403 — the endpoint tells nobody what exists.

## 7. Private Object Storage

**Two buckets, categorically different.**

| Bucket      | Contents                                                                    | Access                                                                   |
| ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Public**  | Product images, gallery images, placement diagrams, OG images, brand assets | CDN, cacheable, immutable keys                                           |
| **Private** | Every customer design file, plus generated previews                         | No public access. No anonymous read. No bucket-level public policy. Ever |

Private bucket configuration:

- Public access is blocked at the bucket level, not only by object ACL.
- No CDN in front of it, so an object cannot be inadvertently cached at an edge.
- Server-side encryption at rest; TLS in transit.
- Keys are unguessable UUIDs and are **never** returned to a client. A client receives an opaque
  `DesignFile.id` and asks for access.
- Prefixes separate lifecycle stages: `quarantine/` (unvalidated) and `designs/` (validated).
  An unvalidated object is never reachable by the normal access path.
- Lifecycle rules delete `quarantine/` objects after 24 hours and orphaned uploads after 7 days.
- Credentials are scoped to these two buckets only, and live in environment variables.

### Signed URLs

| Property     | Value                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Lifetime     | 5 minutes                                                                                                                     |
| Issued       | Per request, after an authorisation check, never in advance                                                                   |
| Cached       | Never — not in a static page, not in a CDN response, not in a server component's output                                       |
| Method       | GET only; a signed PUT is issued only by the upload endpoint and is bound to a key, a content type and a content-length range |
| Logged       | Every **staff** issuance for a design file writes an audit log entry with actor, file, request and timestamp (12.5). A customer reading their own artwork is the expected case and is not logged |
| Rate limited | Per user, so a compromised session cannot enumerate a customer's whole library                                                |

A signed URL leaked from a browser is valid for five minutes for one file. That is the accepted
residual risk, and it is why lifetimes are short.

---

## 8. Session and Cookie Security

| Cookie               | Attributes                                                                       |
| -------------------- | -------------------------------------------------------------------------------- |
| Session              | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, host-only, no `Domain` attribute |
| Anonymous cart token | `HttpOnly`, `Secure`, `SameSite=Lax`, 30-day expiry                              |
| CSRF (where used)    | `Secure`, `SameSite=Strict`                                                      |

- `SameSite=Lax` rather than `Strict`, so a customer following a link from a WhatsApp message
  into their account is not logged out. `Lax` still blocks cross-site POSTs, which is the
  protection that matters.
- No sensitive data is stored in `localStorage` or `sessionStorage`. Builder draft state is
  configuration, not credentials, and contains no file bytes.
- Sessions are invalidated on logout (server-side deletion, not only cookie clearing), on password
  change (all other sessions), and on role change.
- Expired session rows are removed by the daily cleanup job, which also clears expired
  `verification` rows. Because `sessions` holds its token in plaintext (section 2.1), prompt
  cleanup is a security control, not only housekeeping: an expired row is a stealable credential
  that no longer needs to exist.
- The session cookie is the only place the raw session token exists outside `sessions.token`. It
  is never mirrored into `localStorage`, a URL, or a log line.

---

## 9. Rate Limiting

Applied at the action wrapper so no endpoint can be added without a decision about its limit.
Keyed by user ID where authenticated and by IP where not; both where abuse is likely.

| Endpoint                  | Limit                                         | Reason                                            |
| ------------------------- | --------------------------------------------- | ------------------------------------------------- |
| Login                     | 5 / 15 min per identifier, 20 / 15 min per IP | Credential stuffing                               |
| Registration              | 3 / hour per IP                               | Spam accounts                                     |
| Password reset request    | 3 / hour per identifier, 10 / hour per IP     | Mail bombing, enumeration                         |
| Upload presign            | 20 / hour per user, 5 / hour per IP anonymous | Storage exhaustion — the main cost risk           |
| Custom request submission | 10 / day per user                             | Admin queue spam                                  |
| Guest order lookup        | **5 / hour per IP**                           | Enumeration of order numbers and phones           |
| Contact form              | 3 / hour per IP                               | Spam                                              |
| Review submission         | 5 / day per user                              | Spam                                              |
| Coupon application        | 10 / min per cart                             | Code brute-forcing                                |
| Quote accept/reject       | 10 / min per user                             | Abuse of a state transition                       |
| Admin mutations           | 300 / min per user                            | A generous backstop against a compromised session |

Guest order lookup is the tightest limit relative to its legitimate use: it is the one endpoint
that maps an order number to a customer's data, and it is unauthenticated by design.

Limits are enforced in Upstash Redis behind an adapter, with a Postgres fallback so a Redis outage
degrades to slower limiting rather than to none. Exceeding a limit returns a generic message and
`Retry-After`, never a count of remaining attempts.

**What Phase 15 built is the Postgres half**, in `lib/rate-limit`, and it is deliberately the half
built first: there is no Redis in this deployment, and a limiter that exists only in a service
nobody has signed up for is not enforcing anything. Every caller goes through `consume`, so Redis
arrives one day as a second implementation of one function rather than as a change at every call
site.

The counter is a fixed window whose start is part of the key, which makes incrementing a single
atomic `INSERT … ON CONFLICT DO UPDATE` — two simultaneous requests get 1 and 2 rather than both
getting 1. That property is what the integration suite tests, because it is the only one that
cannot be tested without a database. A fixed window allows a burst across a boundary; a sliding one
would not and costs a row per attempt, and for "stop credential stuffing" the trade is the right
way round.

**A refused attempt still counts**, which is correct: an attacker's refused attempts are exactly
what the limit measures. **A database failure allows the request** — a limiter that cannot reach
its store must not take the shop down — and says so in the log.

Enforced at: login, registration, design upload and the guest order lookup. The remaining rows of
the table above have their limits defined in `domain/rate-limit` and are not yet wired to their
call sites.

`RATE_LIMIT=off` disables every limit. It exists for the end-to-end suite, which registers dozens
of accounts from one address in a few minutes — precisely the traffic these limits refuse — and it
announces itself in the log the first time the limiter is asked.

---

## 10. Customer Data Protection

- **Collect the minimum.** Name, phone, email, delivery address. No date of birth, no national
  identifier, no payment card data — cards never touch this system, and under COD they do not
  exist.
- Marketing consent is a separate, explicitly unchecked opt-in, never bundled into terms
  acceptance.
- PII is excluded from logs and from Sentry payloads by a scrubber configured at initialisation,
  covering phone, email, address and full name fields.
- Customer-scoped DTOs never include `internalNotes`, `storageKey`, `accounts.password`,
  `sessions.token`, `verification.value`, or any other customer's data. The DTO mapper is the
  enforcement point, not developer memory.
- Admin views of customer PII are audit-logged.
- **Every admin route and every admin action authorises independently** (Phase 12). The `/admin`
  layout guards what is rendered; each server action calls `requireStaff` and then the capability
  predicate in `domain/permissions` over the loaded actor, because an action is reachable without
  a page ever rendering. A signed-in customer is redirected home rather than shown a refusal, so
  the workshop's existence is not confirmed to them.
- **No admin payload carries a total.** A transition names a target status and the evidence 8.7
  requires; a payment names an amount, a kind and a method. `grandTotal`, `depositRequired`,
  `amountPaid` and `paymentStatus` are absent from every admin schema, re-read from the order
  inside the service, and — for `paymentStatus` — derived from the payment rows rather than set
  (8.8). The starting status of a transition is read from the row, never supplied, so a client
  cannot pick a `from` that makes its target legal.
- **Proof of payment is private media.** It goes through the Phase 9 boundary: a five-minute
  signed URL, a customer read scoped to an order they own, a staff read by capability and
  audit-logged (12.5), and no storage key in any DTO.
- **`robots.txt` and `noindex` are not access control** (Phase 14). They keep a private URL out of
  a search result; they do nothing about a request. Every route named in the disallow list is
  already refused to the wrong actor by `server/auth/guards` and by the ownership filters in the
  repositories, and a test asserts that — the two mechanisms are independent on purpose, because a
  crawler directive is a request that anybody may ignore.
- **Public metadata is built from public DTOs only** (Phase 14). An Open Graph image is the public
  asset URL `lib/media` resolved, never a storage key and never a signed URL; a product's
  description is its own; a review count is the approved aggregate. No customer name, address,
  order number or internal note reaches a `<head>`, a JSON-LD node or a sitemap, and the
  structured-data builders are pure functions over values the page already renders — nothing a
  request supplies reaches them.
- **A resource that is not public gets no canonical** (Phase 14). An unknown, draft or unpublished
  slug returns `noindex` and no `alternates`, so a 404 cannot advertise itself as the address of
  something real, and the sitemap is generated behind the same visibility predicates the pages use
  rather than a second copy of them.
- **A review is the one public string written by somebody outside the business** (Phase 13). Four
  controls, none of which is the interface: it is `PENDING` until a moderator publishes it and
  every public query filters on `status = APPROVED` in the `where`; the payload names an **order
  line**, never a product, and that line is resolved with `order.userId` in the query, so a foreign
  or invented id is "not found" rather than "not yours"; `isVerifiedPurchase` is written from the
  resolved delivered order rather than claimed; and the public DTO carries a shortened display name
  and a date — no e-mail, no user id, no `moderatedByUserId`, no `moderatedAt`. The body is
  rendered as text by React and nothing on that path sets inner HTML (section 12).
- **A gallery item made from a customer's design cannot be published without a recorded consent**
  (13.6). The domain refuses it and a CHECK constraint makes the row impossible; the public image
  is a separately uploaded asset and `sourceDesignFileId`, `imageKey` and `customerConsentAt` are
  absent from every gallery DTO. This is the one place a private customer file could become public
  by accident, which is why it is enforced twice.
- **Homepage `config` is data a person edits, and is read as such** (Phase 13). `domain/content`
  returns well-formed defaults for anything malformed, bounds every `limit` that reaches a query so
  a content edit cannot scan the catalogue, and resolves icons through a closed allow-list rather
  than by name — an arbitrary string reaching a component registry is how a content field becomes a
  way to render something nobody intended.
- **Every customer-portal read is scoped by `userId` inside the query** (Phase 11). A request,
  quote or order belonging to somebody else produces exactly what a nonexistent identifier
  produces — a 404 — so the portal is not an oracle for which numbers exist. The account area
  never consults a guest token: inside it, owning the row is the only thing that grants access.
- **A notification payload is a customer-facing DTO** (Phase 8A) and obeys the same never-serialise
  rule: it is built from the announcing row's own snapshots, so an e-mail can no more carry
  `internalNotes` or a `storageKey` than a page can. Credential e-mails are not stored at all
  (ADR-026), and recipients are resolved from the row or from settings, never from a request.
- Retention: orders retained for accounting purposes; design files retained for 24 months after
  their last referencing order; anonymous carts expired after 30 days; expired sessions and
  consumed tokens cleaned daily.
- Deletion requests anonymise the user record (email, phone and name replaced with tombstones) and
  delete unreferenced design files, while retaining order records, which are financial documents.
- Data is stored in an EU region with an encrypted, backed-up managed database.

---

## 11. Admin Protection

- No public route creates an admin account. The first admin is seeded; later ones are created by
  an existing admin.
- `/admin` is protected by a route-group layout check plus the `adminAction` wrapper on every
  mutation. Neither alone is sufficient.
- Admin sessions are shorter: 7 days rather than 30.
- Two-factor authentication for staff accounts is the first V1.5 security item.
- Every admin mutation writes an audit log entry: actor, action, entity, timestamp, IP.
- Destructive admin actions require typed confirmation and are soft where the data has history.
- The last remaining `ADMIN` cannot be deleted or demoted, and an admin cannot change their own
  role.
- Admin pages set `X-Robots-Tag: noindex, nofollow` and are excluded from the sitemap.
- Error responses in admin routes carry no more internal detail than customer-facing ones; a
  compromised admin session must not become a source-code reconnaissance tool.

---

## 12. Cross-Site Scripting

- React escapes by default. `dangerouslySetInnerHTML` is prohibited except for rendering
  admin-authored markdown, which is passed through a sanitiser with a strict allowlist that
  excludes `script`, `iframe`, `object`, `embed`, event handlers and `javascript:` URLs.
- Customer-authored content (reviews, instructions, notes, filenames) is rendered as text, never
  as markup, in the storefront **and** in the admin. A stored payload that only fires in the admin
  is worse, not better.
- Uploaded SVGs are never rendered inline. See section 6.
- Content Security Policy, delivered as a header, with nonces for the framework's inline scripts:

```
default-src 'self';
script-src 'self' 'nonce-{n}' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://{public-cdn};
font-src 'self';
connect-src 'self' https://{storage-host} https://{sentry-host};
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
object-src 'none';
upgrade-insecure-requests;
```

The private storage host is deliberately absent from `img-src`: private files are downloaded, not
embedded.

Additional headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `Strict-Transport-Security` with a long max-age and
`includeSubDomains`, `Permissions-Policy` denying camera, microphone and geolocation except where
the upload flow needs camera access.

---

## 13. CSRF

- Server actions are protected by Next.js's built-in origin and host comparison, which rejects
  cross-origin POSTs. This is relied upon but is not treated as the entire defence.
- `SameSite=Lax` on the session cookie blocks cross-site POST navigation, which covers the classic
  CSRF vector independently.
- Route handlers that mutate state and are not webhooks verify the `Origin` header explicitly and
  reject a mismatch.
- Webhooks are exempt from origin checks by necessity and are instead protected by provider
  signature verification with a constant-time comparison, a timestamp freshness window, and
  idempotency keyed on the provider's event ID.
- Cron endpoints require a shared secret in a header, compared in constant time.
- No state-changing operation is ever performed by a GET request.

---

## 14. Secrets and Dependencies

- Secrets live only in platform environment variables, validated at boot by `lib/env.ts`; the
  application refuses to start on a missing or malformed variable, so a misconfiguration is a
  failed deploy rather than a silent security gap.
- No secret is ever prefixed `NEXT_PUBLIC_`. A lint rule blocks importing the server env module
  from client code.
- `.env*` files are git-ignored; a committed-secret scan runs in CI.
- Storage and email credentials are scoped to the minimum necessary permissions.
- Dependencies: lockfile committed, `npm audit` in CI, Dependabot for security updates, and a
  deliberate preference for few, well-maintained packages. Every new dependency is a supply-chain
  decision.

---

## 15. Monitoring and Response

**Logged as security events**: failed logins with identifier and IP, successful logins from a new
IP, password changes and resets, role changes, admin design-file access, admin PII views, order
status changes, rate-limit breaches, file validation rejections, and authorisation denials.

Audit log entries are append-only, retained 24 months, and readable only by `ADMIN`.

**Alert on**: a spike in failed logins, a spike in file-validation rejections, any `QUARANTINED`
file, an unusual volume of guest order lookups, and a 5xx rate above threshold.

**Incident response**: revoke sessions (delete session rows — instantly effective, which is why
database sessions were chosen), rotate the affected credentials, use the audit log to determine
what was accessed, notify affected customers if design files or PII were exposed, and record the
incident with its remediation.

---

## 16. Pre-Launch Security Checklist

Verified before V1 goes live:

- [ ] No customer can access another customer's order, quote, request, or file — tested per resource
- [ ] Design files return 404 or 403 for unauthorised users and are never publicly reachable
- [ ] The private bucket has no public access policy, verified from an unauthenticated client
- [ ] Every price and total in a placed order was computed server-side
- [ ] Every order status change went through the state machine
- [ ] Every mutation validates input server-side with Zod
- [ ] SVG upload with an embedded script is rejected or sanitised, and never renders
- [ ] A file whose extension disagrees with its magic number is rejected
- [ ] Upload size and count limits hold when the client's declared values are forged
- [x] Rate limits are effective on login, upload and guest lookup — Phase 15. There is no contact
      form to limit
- [ ] Session cookies carry `HttpOnly`, `Secure` and `SameSite`
- [ ] Password reset does not disclose whether an address exists
- [ ] Admin routes are inaccessible to a `CUSTOMER` session at both the layout and action layers
- [x] CSP is enforced and the site functions without inline scripts outside the framework's nonce —
      Phase 15, ADR-041. Verified in a browser across every storefront route with zero violations
- [x] All security headers are present in production — the policy from the middleware, the rest
      from `next.config.ts`
- [ ] No secret is exposed to the client bundle
- [ ] PII is scrubbed from logs and error reports
- [ ] Audit logging fires for file access, PII views and status changes
- [x] Dependency audit is clean of high and critical advisories — Phase 15. Four high advisories in
      the Prisma CLI's transitive tree (`mysql2`, `deepmerge-ts`) were closed with `overrides` in
      `package.json` rather than by taking npm's suggested downgrade to Prisma 6, which would have
      undone the Prisma 7 architecture. `npm audit` reports zero
