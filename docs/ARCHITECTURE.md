# ARCHITECTURE.md

> The technical architecture for Bizeora. Data design is in `DATABASE.md`.
> Rules the domain layer enforces are in `BUSINESS-RULES.md`. Rationale is in `DECISIONS.md`.

---

## 1. Architectural Goals

The constraints that shaped every decision below:

1. **One person maintains this.** Boring, well-documented technology beats clever technology.
2. **Business rules must exist in exactly one place.** Pricing errors are the most expensive
   class of bug in commerce.
3. **Ship a single deployable unit.** No microservices, no separate API server, no queue
   infrastructure until there is a measured reason.
4. **Server-first.** Minimal client JavaScript; the storefront must be fast on mobile networks.
5. **Security is structural, not additive.** Authorisation lives in the data-access layer, not
   in page components.
6. **Nothing about Algeria is hard-coded.** Currency, wilayas, delivery types and payment
   methods are data and adapters, not constants scattered through the code.

---

## 2. Stack

| Concern       | Choice                                                             | Note                                               |
| ------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| Framework     | **Next.js (App Router)**, latest stable                            | RSC, server actions, streaming, image optimisation |
| Language      | **TypeScript**, `strict: true`                                     | `noUncheckedIndexedAccess` on                      |
| UI            | **React** (server components by default)                           |                                                    |
| Styling       | **Tailwind CSS** + CSS custom properties for tokens                | Tokens are CSS variables so the brand is swappable |
| Components    | **shadcn/ui** (Radix primitives), restyled to the design system    | Copied into the repo, not a dependency             |
| Database      | **PostgreSQL** (managed: Neon or Supabase, EU region)              |                                                    |
| ORM           | **Prisma**                                                         | ADR-002                                            |
| Auth          | **Better Auth 1.7.2**, database sessions, Argon2id                 | ADR-006, ADR-019, ADR-020                          |
| Validation    | **Zod**                                                            | One schema per boundary, shared client/server      |
| File storage  | **S3-compatible object storage** (Cloudflare R2) behind an adapter | ADR-009                                            |
| Email         | **Resend** behind a notification adapter                           |                                                    |
| Rate limiting | **Upstash Redis** (or Postgres fallback) behind an adapter         |                                                    |
| Testing       | **Vitest** (unit/integration), **Playwright** (E2E)                |                                                    |
| Quality       | ESLint, Prettier, `tsc --noEmit` in CI                             |                                                    |
| Hosting       | **Vercel**                                                         | Cron for scheduled jobs                            |
| Monitoring    | **Sentry** + Vercel Analytics                                      |                                                    |

Version numbers are deliberately not pinned in this document; the foundation phase pins them in
`package.json` and records the actual versions there.

---

## 3. Application Architecture

A layered monolith. Dependencies point strictly downward; a lower layer never imports an upper one.

```
┌──────────────────────────────────────────────────────────┐
│  Presentation        app/  · components/                 │
│  RSC pages, client islands, forms                        │
├──────────────────────────────────────────────────────────┤
│  Entry points        server/actions/  · app/api/         │
│  auth · validation · rate limit · error normalisation    │
├──────────────────────────────────────────────────────────┤
│  Services            server/services/                    │
│  orchestration, transactions, side effects               │
├──────────────────────────────────────────────────────────┤
│  Domain              domain/                             │
│  PURE business logic: pricing, totals, state machines    │
├──────────────────────────────────────────────────────────┤
│  Data access         server/repositories/                │
│  Prisma queries, ownership scoping                       │
├──────────────────────────────────────────────────────────┤
│  Infrastructure      lib/                                │
│  db · storage · payments · notifications · rate limit    │
└──────────────────────────────────────────────────────────┘
```

### Layer contracts

**Domain (`domain/`)** — the most important rule in the codebase.
Pure TypeScript functions and types. **No imports from Prisma, Next.js, React, or any I/O.**
Takes plain data, returns plain data or a typed error. Fully unit-testable without a database.
Contains: price calculation, cart totals, discount application, shipping resolution, quote
totals, deposit calculation, and every state machine (order, request, quote).

**Repositories (`server/repositories/`)** — the only place Prisma is imported.
Every function that reads or writes customer-owned data takes an explicit actor and scopes the
query by ownership. There is no repository function that returns another customer's data by ID
without a scope argument. This makes IDOR a compile-time shape rather than a review checklist.

**Services (`server/services/`)** — orchestration.
Load data through repositories, call domain functions, persist results, emit side effects
(notifications, audit entries) inside or immediately after the transaction. Services own
transaction boundaries. Services do not contain arithmetic or status rules; they call the domain.

**Entry points (`server/actions/`, `app/api/`)** — the security boundary.
Every mutation passes through a wrapper that resolves the session, checks the role, validates
input with Zod, applies rate limiting, calls one service, and normalises the result. No entry
point queries the database directly.

**Presentation** — renders. Never calculates a price, never decides an authorisation outcome.

### Why not a heavier architecture

A hexagonal/DDD structure with aggregates and a domain event bus was considered and rejected as
over-engineering for a single-store application maintained by one person. The pure-domain layer
captures the actual benefit — testable, single-source business rules — at a fraction of the cost.
See ADR-001.

---

## 4. Next.js Architecture

### Route groups

> **Revised in Phase 14.7.** The storefront moved under a language segment and the workshop moved
> into a route group of its own, so the two trees can carry different `<html lang>` attributes.
> ADR-030 records why.

```
app/
├── (site)/[locale]/           the public site — `/fr/…` and `/en/…`
│   ├── layout.tsx             ROOT layout: <html lang>, theme script, storefront chrome
│   ├── (storefront)/          marketing, catalogue, cart, checkout, account portal
│   └── (auth)/                login and register; minimal shell
├── (workshop)/                unprefixed; its language is the NEXT_LOCALE cookie
│   ├── layout.tsx             ROOT layout: <html lang> from the cookie, dictionary provider
│   ├── admin/                 requires STAFF or ADMIN
│   └── dev/design-system/     the showcase; 404 in production
├── api/                       webhooks, uploads, notification dispatcher
├── assets/[...path]/          the public media the storage adapter holds (ADR-032)
├── icon.png                   the favicon, from the brand mark
├── sitemap.ts, robots.ts      unprefixed, both languages inside
└── opengraph-image.tsx        the site-level social card
```

`app/assets/[...path]` answers only for keys under the `media/` prefix, and only when
`NEXT_PUBLIC_PUBLIC_ASSET_URL` points at this origin; with a CDN in front of a public bucket it is
never reached. Static files in `public/assets` are served before any route is consulted, which is
how the placeholder photography and uploaded media share one origin.

**There is no `app/layout.tsx`.** Two root layouts, one per group, because the document's own
`lang` attribute differs between them and a shared root could only lie about one of the two. Each
group owns its `loading.tsx`, `error.tsx` and `not-found.tsx`.

### The language prefix

`middleware.ts` runs at the edge — no Prisma, no database, nothing but string work — and redirects
an unprefixed public path to a localised one, choosing the language from the `NEXT_LOCALE` cookie
first and `Accept-Language` second. `/admin`, `/api`, `/dev`, `/assets`, `/_next`, `sitemap.xml`
and `robots.txt` are never prefixed; the list lives in `i18n/routing.ts` and the middleware's
matcher agrees with it.

Inside the application nothing is prefixed by hand:

- **`Link`** takes the locale from `usePathname()` and prefixes a string `href`, so a caller writes
  `href="/shop"` exactly as before. This is why that primitive is a client component.
- **A storefront server component** reads `params.locale` and calls `dictionaryFor(locale)`.
- **A workshop server component** calls `workshopDictionary()`, which reads the `NEXT_LOCALE`
  cookie — `/admin` has no prefix and never will (ADR-033).
- **Any client component** calls `useDictionary()`, which prefers the provider the workshop's
  layout renders and otherwise reads the pathname.

`generateStaticParams` returns both locales, so the statically rendered pages are built twice, and
`generateMetadata` emits `alternates.languages` (`hreflang`, with `x-default`) on every public
page.

### Rendering strategy per route class

| Route class                           | Strategy                                                                 | Reason                                             |
| ------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| Home, About, How It Works, FAQ, legal | Static, revalidated on content change via tag                            | Content changes rarely; must be fast and indexable |
| Category listings (`/shop/c/…`)       | Dynamic, server-rendered                                                 | Carries the same search and filters as `/shop`     |
| Product detail                        | Static with tag revalidation; live stock streamed in a suspense boundary | Fast first paint, accurate stock                   |
| Catalogue (`/shop`)                   | Dynamic, server-rendered                                                 | Reads `searchParams` since Phase 14.13 (ADR-039)   |
| Cart, checkout                        | Dynamic, never cached                                                    | Per-user                                           |
| Account, admin                        | Dynamic, never cached, `no-store`                                        | Private                                            |
| Gallery                               | Static with tag revalidation                                             |                                                    |

**A storefront path is invalidated by the name it was stored under.** This has been got wrong
twice, in both directions, and the failure mode is always the same: the write succeeds, the screen
says so, and the page keeps its old copy until the timer expires.

A prerendered page carries the tags Next derived from its **internal** route, route groups
included. They can be read straight out of a production build — `.next/server/app/fr.meta` lists
them — and for the front page they are:

```
_N_T_/layout
_N_T_/(site)/layout
_N_T_/(site)/[locale]/layout
_N_T_/(site)/[locale]/(storefront)/layout
_N_T_/(site)/[locale]/(storefront)/page
_N_T_/fr
```

So there are exactly two correct forms:

- **One page, one language**: the concrete path with **no** type — `revalidatePath('/fr/shop')`,
  `revalidatePath('/en/shop')`, in a loop over `LOCALES`. `revalidatePath('/shop')` matched nothing
  from the moment the site became bilingual, and `revalidatePath('/[locale]/shop', 'page')` never
  matched anything at all, because it omits the groups.
- **A whole subtree, every language at once**: the layout, named **with its route group** —
  `revalidatePath('/(site)/[locale]', 'layout')`. This is what a settings change uses, because the
  shop's name is in every title and the storefront switch decides whether there is a page at all.

`revalidatePath('/fr', 'layout')` is the trap: it looks like the concrete form, produces
`_N_T_/fr/layout`, and matches nothing. See ADR-038.

### Where content is translated

Two mechanisms, one rule: **the language reaches the data, and the data comes back translated.**

- **Interface copy** — every word the developers write — lives in `i18n/dictionaries`. A storefront
  server component reads `params.locale`, an admin one calls `workshopDictionary()`, a client one
  calls `useDictionary()` (ADR-030, ADR-033).
- **Content the business writes** — product names, category names, gallery captions, the banner,
  the homepage's bands — lives in the database with an English overlay beside it, and is merged
  **at the repository boundary** by `localise` (ADR-040). Every storefront read takes a locale;
  pages pass theirs and receive DTOs that are already in the right language.

The boundary is the point. A page that translated its own data would be a page that could forget
to, and the failure — a French name on an English screen — is invisible to anybody testing in
French.

Revalidation is **tag-based**, never blind time-based. Publishing a product revalidates
`product:<slug>`, `category:<slug>`, `products:list` and `home`. This is a service responsibility,
executed after a successful write.

### Server and client boundaries

Server Components are the default. A component becomes a client component only when it needs
state, effects, browser APIs, or event handlers.

**Legitimate client islands, and nothing more:**
header search overlay and mobile drawer · product image gallery · variant selector ·
add-to-cart button · cart slide-over and quantity steppers · the custom builder's interactive
steps · the file uploader · the design-preview overlay · checkout form sections ·
admin tables (sorting, selection, filters) · the admin quote line editor · toasts · dialogs.

Phase 14.7 added one more category: **leaves that read the language or the theme from the
document.** `Link`, the language switcher, the theme toggle, the status badges, the rating, the
quote table and the product card are client components because the alternative is a `locale` prop
on every call site in the application (ADR-030). They still render on the server; what ships is an
`<a>`, a `<span>` and a dictionary that was already in the bundle.

Rules:

- Push the boundary as far down the tree as possible. A page is never `"use client"`.
- Client components receive **plain serialisable props**. Never a Prisma model — always a mapped
  DTO with money as integers and dates as ISO strings.
- Server-only modules import `server-only` so an accidental client import fails at build time.
- Environment variables are read through a validated `env` module; only `NEXT_PUBLIC_` values are
  reachable from the client.

---

## 5. Domain Architecture

```
domain/
├── money/          Money type, arithmetic, rounding, formatting rules
├── pricing/        variant price, customisation price, line price, estimate ranges
├── cart/           totals, validation, quote-locked line handling
├── discount/       coupon eligibility and application
├── shipping/       zone and rate resolution, free-shipping threshold
├── quote/          quote totals, expiry, versioning rules
├── order/          order totals, deposit calculation, state machine
├── request/        custom-request state machine, pricing-mode determination
├── customization/  configuration validation, option compatibility
└── files/          filename, extension, MIME and size policy (pure predicates)
```

### Money

**All money is an integer count of minor units, plus an ISO currency code.** Never a float,
never a JavaScript number produced by arithmetic on decimals. Rounding happens once, at defined
points, using a single documented rule (half-up on the final line total). The `Money` type is a
branded integer so it cannot be silently mixed with a quantity.

DZD is stored in centimes for uniformity even though prices are quoted in whole dinars, so a
future market with subunits requires no migration.

### The pricing pipeline

One pipeline serves the product page, the builder estimate, the cart, checkout, the quote builder
and the admin. Its input is a snapshot; it performs no I/O.

```
resolveUnitPrice(variant, product)
  -> applyCustomizationSurcharges(config, priceRules)
  -> lineTotal(unitPrice, quantity)
  -> applyLineDiscounts()
  -> subtotal
  -> applyCoupon(coupon, subtotal, eligibility)
  -> resolveShipping(zone, deliveryType, subtotal, settings)
  -> applyTax(settings)
  -> grandTotal
  -> depositDue(order, settings)
```

Every stage returns a **breakdown**, not just a number, so the UI, the quote document and the
order record can all show how the total was reached without recomputing it.

### State machines

Order, custom request and quote transitions are declarative maps of allowed transitions plus
guard predicates. A transition is requested through a single function that returns either the new
state and the history entry to write, or a typed rejection. No service mutates a status field
directly. This is what makes the status history trustworthy.

---

## 6. Data Access

### Repository pattern

```ts
// shape, not final code
listOrdersForCustomer(actor: CustomerActor, page: Pagination): Promise<OrderSummary[]>
getOrderForCustomer(actor: CustomerActor, orderNumber: string): Promise<OrderDetail | null>
getOrderForAdmin(actor: AdminActor, id: string): Promise<OrderDetail | null>
```

- Customer-scoped functions always filter by `actor.userId` in the query itself. They never fetch
  and then compare, because a fetch-then-compare is one forgotten line away from a leak.
- Admin functions require an admin actor type, which only the admin action wrapper can construct.
  That wrapper is `server/auth/guards` (`requireStaff`, `requireCustomer`, `requireSignedIn`),
  added in Phase 10. It reads the actor and asks `domain/permissions`; it never decides anything
  itself. `/admin` puts it in the route-group layout **and** in every action, because a layout
  protects what is rendered and a server action is reachable without rendering one.
- Repositories return mapped DTOs, not raw Prisma models, so Decimal, Date and internal fields
  never leak into a client payload.

### Query discipline

- Every list endpoint is paginated. No unbounded `findMany`.
- Admin lists use **keyset pagination** on `(createdAt, id)`; storefront listings use offset
  pagination with a capped page number for SEO-friendly URLs.
- Explicit `select` on every query. `include` of a whole relation tree is prohibited in list
  contexts.
- N+1 avoidance is verified by logging query counts in development for the product listing,
  order list and admin queues.
- Multi-write operations run in `prisma.$transaction`, including order creation, quote sending,
  status transitions and stock decrements.

### The checkout transaction boundary

Order placement is the project's first multi-table write that takes money, and its boundary is
worth stating explicitly because every later flow copies it.

```
resolve the owner (session user, or the guest cart cookie)
  -> re-read the cart, scoped to that owner in the query
  -> re-price every line through server/services/cart-pricing   [the one path]
  -> resolve delivery from shipping_rates via domain/shipping
  -> compute totals, deposit and entry status in domain/order
  -> ONE prisma.$transaction:
       claim the cart  (UPDATE ... WHERE status = 'ACTIVE')
       reserve stock   (UPDATE ... WHERE stock - reserved >= n)   [per ADR-022]
       take an order number from next_order_number()
       create the order, its items, its address and its first history row
```

Three properties come from where the work happens rather than from care:

- **Idempotency is the cart claim.** A double submission is not prevented by checking whether an
  order exists — two requests can pass that check in the same instant. The transaction begins by
  updating the cart from `ACTIVE`, and the second attempt matches zero rows and aborts.
- **Overselling is impossible because the availability test is in the `WHERE` clause.** Reading
  stock, checking it in JavaScript and writing it back is the canonical race; here the second
  writer matches no row.
- **Nothing partial survives a failure.** The number, the reservation, the order, its items, its
  address and its history are one transaction, so a violated constraint anywhere rolls back the
  reservation and returns the cart to `ACTIVE`.

Money invariants are additionally enforced by check constraints —
`grand_total = subtotal - discount_total + shipping_total + tax_total`,
`line_total = unit_price * quantity - line_discount`, `deposit_required <= grand_total`,
`reserved_quantity <= stock_quantity`. They exist because an invariant that depends only on the
application being correct is an invariant that will eventually be wrong, and one of them caught a
real defect during Phase 8: a quote's fee line reaching `order_items` without a `feeKind`.

### Pricing authority

There is exactly one path from a cart to a number, and it runs on the server:

```
server/services/cart-pricing.priceCart(cartData, { settings, tiers, placementModifiers, shipping })
```

The cart page, the checkout summary, the delivery quote and order placement all call it. A client
component receives **priced lines and finished totals** and renders them; it never multiplies a
price by a quantity, applies a percentage, or adds a delivery charge to a subtotal. That is why
the delivery quote returns the whole totals for each option rather than just the option's price —
the alternative was `subtotal - discount + shipping` in React, which is the section 5.1 pipeline
in the one place it must not be.

Neither cart mutations nor checkout accept a price, a subtotal, a discount, a shipping amount, a
total or a deposit. Those fields are **absent from the Zod schemas**, so a payload carrying them
fails to parse rather than being trusted by accident.

### Caching the public catalogue

Storefront catalogue routes use **incremental static regeneration with a
five-minute window** (`export const revalidate = 300`). The catalogue changes
occasionally and is read constantly, so a short cache absorbs nearly all of the
read load without an elaborate layer.

Product detail deliberately has **no `generateStaticParams`**. Prerendering
every product at build time would tie each deploy to a snapshot of the
catalogue and leave every edit stale until the next build; on demand plus a
revalidation window keeps the two independent.

Tag-based revalidation replaces the timer once the admin can mutate products
and therefore knows what to invalidate. Inventing cache tags before any
mutation writes to them would be inventing a key nothing signals.

### Migrations

Prisma Migrate. Migrations are committed, reviewed and forward-only. Destructive changes are
performed as expand-migrate-contract across releases once real data exists. Seed data covers
wilayas, placements, thread colours, embroidery sizes, settings and a demo catalogue.

---

## 7. Authentication

**Better Auth 1.7.2 with database-backed sessions.** Implemented in Phase 3. See ADR-006 and its
Phase 2.3 amendment, plus ADR-019 and ADR-020.

- Email plus password for customers and staff. **Argon2id** via `@node-rs/argon2`, wired through
  `emailAndPassword.password` — Better Auth's supported override for its default scrypt, so the
  project's hashing requirement is met without patching the library.
- The credential hash lives on the account row (`accounts.password` where
  `providerId = 'credential'` and `issuer = 'local:credential'`). There is no `users.passwordHash`.
- Sessions are opaque tokens in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, with the session
  record in Postgres. Database sessions are chosen over stateless JWTs so that a session can be
  revoked instantly — necessary when an admin account is compromised or a staff member leaves.
- Session lifetime 30 days for customers and 7 days for staff and admin, rolling refresh at 24
  hours. See "Session handling" below for how the two coexist under one library setting.
- **`sessions.token` is stored as issued; the password-reset token is hashed at rest; the
  email-verification code is encrypted at rest.** The three differ because their entropy and the
  library's mechanisms differ, not by accident. `SECURITY.md` section 2.1 sets out each one.
- **Email verification is an 8-digit single-use code**, not a link: the `emailOTP` plugin with
  `overrideDefaultEmailVerification: true`, replacing a default JWT link that was replayable until
  it expired. See ADR-021.
- Phone is captured and stored but not used as a login factor in V1; OTP login is a V2 option and
  the schema does not preclude it.
- Admin accounts are provisioned by seed or by an existing admin. There is no public admin
  registration route.

### The boundary

Everything Better Auth is lives in `src/lib/auth/`:

| File          | Responsibility                                                                    |
| ------------- | --------------------------------------------------------------------------------- |
| `config.ts`   | Constructs the instance. The only file that calls `betterAuth()`                   |
| `password.ts` | Argon2id hash and verify, injected into the config                                 |
| `session.ts`  | Reads the current session and maps it to our `Actor`. Enforces the staff time cap  |
| `index.ts`    | The public surface: `getCurrentActor`, `revokeAllSessionsForUser`, and nothing else |

`src/app/api/auth/[...all]/route.ts` mounts the endpoints with `toNextJsHandler`, pinned to the
Node.js runtime because Argon2id is a native module the Edge runtime cannot load.

**No Better Auth type is exported from this directory.** Application code receives an `Actor` —
defined in `domain/auth/actor.ts`, a plain object with `userId`, `role`, `emailVerified` and
`status`. Replacing the auth provider means rewriting `lib/auth/` and nothing else. The
import-boundary lint rule enforces it from both sides: `domain/` may not import `better-auth`,
`@better-auth/*` or `@node-rs/argon2`, and `components/` may not import `better-auth` or
`@/lib/auth`.

### Persistence

Better Auth persists through its **Prisma adapter**, against the same `PrismaClient` singleton and
the same schema as the rest of the application — one database, one connection strategy, no second
store. Transactions are enabled, so a sign-up that creates a user and its credential account
commits or rolls back as a unit.

Its four core models (`User`, `Session`, `Account`, `Verification`) are documented in
`DATABASE.md` section 4 and carry the library's field names, because the adapter queries by them.
Primary keys stay `uuidv7()`: `advanced.database.generateId: false` makes Better Auth omit `id`
from every insert so PostgreSQL generates it.

This is the one documented exception to section 6's rule that only `server/repositories/` imports
Prisma. The adapter **is** the repository for the auth tables, so it holds the client here. It
reaches `users`, `sessions`, `accounts` and `verification` and nothing else — no business table is
queried from `lib/auth/`.

### Session handling

Better Auth exposes a single global `session.expiresIn`, but the project has two lifetimes. They
are reconciled in two places, and it takes both:

1. `databaseHooks.session.create.before` looks up the user's role and clamps `expiresAt` to seven
   days for `STAFF` and `ADMIN` at creation.
2. `getCurrentActor` enforces an **absolute cap** on `sessions.createdAt` for those roles and
   deletes the row once it is exceeded.

The second is not belt-and-braces. Better Auth's rolling refresh rewrites `expiresAt` from the
global `expiresIn`, which would quietly restore an admin session to 30 days on its first refresh;
`createdAt` cannot drift, so it is what the cap is measured from. Deleting rather than merely
refusing keeps one meaning for "the session row exists" and preserves revocation-by-deletion as
the single mechanism.

`getCurrentActor` is wrapped in React's `cache`, so several server components and a server action
in one render share a single session lookup — the mitigation ADR-006 names for the per-request read
that database sessions cost.

### Authentication and authorisation are separate concerns

Better Auth owns **authentication only**: credentials, sessions, email verification, password
reset, and later staff two-factor. That is the whole of its remit.

- **Better Auth's admin and permission plugins are not used.** `users.role` is our own column, and
  every permission decision lives in `domain/permissions` as a pure function over
  `(actor, resource)`.
- **No Better Auth type appears outside `lib/auth/`.** Services, repositories and the domain layer
  see only our `Actor` type. This is enforced by the same import-boundary lint rule that protects
  the domain layer.
- Consequence: authorisation is unit-testable without a session, a database or the auth library,
  and replacing the auth provider touches one directory. See ADR-006.

---

## 8. Authorisation

Three roles: `CUSTOMER`, `STAFF`, `ADMIN`. Enforced in three places, all server-side.

1. **Middleware** — coarse routing only. Redirects unauthenticated users away from `/account`
   and `/admin`. It is a UX convenience and is **never** the security boundary, because
   middleware does not run for every data path.
2. **Action and route wrappers** — the real boundary. `customerAction`, `adminAction` and
   `publicAction` resolve the session, assert the role, and construct the typed actor that
   repositories require.
3. **Repositories** — ownership scoping, as described in section 6.

Permission predicates (`canViewOrder`, `canAcceptQuote`, `canTransitionOrder`) live in the domain
layer as pure functions so they are unit-testable and cannot drift between UI and server.

Hiding a UI control is presentation, never protection.

---

## 9. Storage

```
Client -> request presigned upload -> validate intent server-side
       -> PUT directly to private bucket (quarantine/ prefix)
       -> notify server -> server fetches header bytes, validates
       -> promote to designs/ prefix, write DesignFile row (READY)
       -> access only via short-lived signed GET URLs
```

Details and the threat model are in `SECURITY.md` sections 6 to 8. Architectural points:

- Two buckets: **public** (product images, gallery, placement diagrams, OG images) served through
  a CDN, and **private** (customer design files) with no public access whatsoever.
- Uploads go **direct to storage** via presigned URLs, not through the application server. This
  avoids serverless body-size limits and keeps large files off the request path.
- Validation happens server-side **after** upload by reading the file's magic bytes, because the
  client-supplied content type is not evidence.
- Files land in a `quarantine/` prefix and are promoted only after validation, so an unvalidated
  object is never reachable through the normal access path.
- All access is through `lib/storage`'s adapter interface (`put`, `presignPut`, `presignGet`,
  `delete`, `head`), so R2, S3 or Supabase Storage are interchangeable.
- Signed GET URLs are short-lived (5 minutes), issued per request after an authorisation check,
  and never cached in a server component's static output.

### The storage adapter, as built

`lib/storage` is the whole of the provider decision. Above it, a service asks
for a signed URL and receives a string; it cannot discover which provider
produced it, and nothing outside that directory imports an SDK or holds a
credential.

```
lib/storage/
  types.ts   the interface: presignPut, presignGet, put, head, getRange, get, move, delete
  keys.ts    server-generated keys — quarantine/, designs/, previews/
  s3.ts      the S3-compatible adapter (Cloudflare R2 in production, ADR-009)
  local.ts   a filesystem adapter for development and the test suite
  index.ts   picks one, lazily
```

**The local adapter is not a mock.** It stores bytes, signs URLs with an HMAC
over the key, method, content type, length and expiry, and refuses an oversized
or retyped body — so the flow under test is the real three-step sequence rather
than a shortcut only development takes. The application's own
`/api/storage/local` route plays the provider's part; it disappears the moment a
bucket is configured.

Two rules about selection, both learned the hard way:

- **The adapter is built lazily.** Constructing it at module evaluation made
  `next build` fail on a machine with no bucket, because a build runs with
  `NODE_ENV=production` and walks every route's module graph. A build is not a
  request.
- **A deployment is recognised by its origin, not by `NODE_ENV`.**
  `npm run build && npm run start` on a laptop is also production, and that is
  how the end-to-end suite runs the application. The filesystem adapter is
  permitted only when `NEXT_PUBLIC_SITE_URL` is a localhost origin; anything
  else without credentials throws, naming the variables that are missing.

### The upload pipeline

```
browser                         server                          storage
   |  filename, type, size  ->  validate the intent
   |                            generate a key (a UUID, never the filename)
   |  <- presigned PUT          write DesignFile PENDING
   |  --------------------  PUT the bytes  ------------------->  quarantine/
   |  designFileId  ------->    HEAD: real size
   |                            read the bytes: real type by magic number
   |                            extension, MIME and magic number must agree
   |                            raster: decode the pixels, cap the dimensions
   |                            SVG: refuse anything hostile (ADR-024)
   |                            PNG/JPG: generate a preview   ->  previews/
   |                            promote                        ->  designs/
   |  <- READY                  write READY
```

The sentence that governs the whole diagram: **a file is not `READY` because the
browser says the upload worked.** The client's only contribution to finalisation
is the file's id, and that is scoped to its owner before anything is read.

Finalisation is idempotent — `markFileReady` moves a row only from `PENDING`, so
a retry on a flaky connection returns the same view rather than a second file.
A validation failure marks the row `REJECTED`, keeps the reason, and deletes the
object; an upload that never arrives stays `PENDING` so a retry can still
succeed, and `sweepStalePendingUploads` takes it after 24 hours.

### File ownership

A design file is created at presign time, before any request exists to hang
authorisation on, so it carries an owner from the first moment: `ownerUserId`
for a signed-in customer, or `ownerTokenHash` — the SHA-256 of **the same guest
token that identifies a guest cart**. One browser is one guest across uploads,
cart and orders; there is no second identity system.

Every read is scoped in the query. A file id belonging to someone else returns
"not found", indistinguishable from an id that never existed, so the endpoint is
not an oracle for enumerating them. A client never receives a storage key: it
holds an opaque `DesignFile.id` and asks for access.

---

## 10. Payments

V1 supports Cash on Delivery and manual bank/CCP transfer. The abstraction exists so that adding
a provider later is an adapter, not a refactor.

```ts
interface PaymentProvider {
  id: string;
  supports(context: PaymentContext): boolean; // order type, amount, currency
  createIntent(order, amount): Promise<PaymentIntent>;
  handleWebhook(request): Promise<PaymentEvent>; // no-op for offline methods
  capture(reference): Promise<PaymentResult>;
  refund(reference, amount): Promise<PaymentResult>;
}
```

- Available methods are resolved at checkout by asking every registered provider whether it
  supports the order, so the rule "custom orders cannot be pure COD" is expressed once.
- `Payment` rows are separate from `Order` so an order can carry a deposit and a balance, and so
  a future provider's partial captures and refunds fit without schema change.
- Webhook routes are `app/api/webhooks/[provider]`, signature-verified, and **idempotent** by
  provider event ID.
- Payment status is derived from payment rows, never set by hand in the admin UI without also
  writing a payment record.

---

## 11. Notifications

An **outbox**, not direct sends. A service writes a `Notification` row inside the same
transaction as the state change, and a dispatcher delivers it. A failed email never rolls back an
order, and a delivered order never fails to notify because a provider was briefly down.

```ts
interface NotificationChannel {
  id: 'email' | 'whatsapp' | 'sms' | 'in_app';
  isEnabled(): boolean;
  send(notification: Notification): Promise<DeliveryResult>;
}
```

### V1 scope: transactional email is not optional

Password reset and email verification already require a working email sender in Phase 3, so email
delivery is a V1 dependency regardless. Shipping the outbox without a dispatcher would mean orders
are placed and the customer is told nothing — and for a guest, the confirmation email is their
only record of the purchase.

**V1 ships the email channel with an active dispatcher**, covering:

| Audience  | Event                 | Purpose                                                                   |
| --------- | --------------------- | ------------------------------------------------------------------------- |
| Customer  | `auth.verify_email`   | Account activation                                                        |
| Customer  | `auth.password_reset` | Account recovery                                                          |
| Customer  | `order.confirmed`     | The order confirmation — the guest's only record                          |
| Customer  | `quote.sent`          | The quote is ready. Without this the response-time promise is meaningless |
| Customer  | `quote.expiring`      | Before `validUntil`, and before `acceptanceValidUntil`                    |
| **Admin** | `request.submitted`   | A new custom request is waiting                                           |
| **Admin** | `quote.expiring`      | A sent quote is about to lapse unanswered                                 |
| **Admin** | `order.placed`        | A new order needs confirming                                              |

Admin-directed notifications use the **same outbox and the same channel interface**, addressed to
staff recipients resolved from the `notifications` settings group. There is no second notification
system. Without them the platform's core promise — a quote within six working hours — depends on
the owner voluntarily opening the admin, which is the WhatsApp status quo the product exists to
replace.

Also in V1: in-app notification records, and a **WhatsApp click-to-chat link generator** the admin
uses manually. The WhatsApp _channel_ exists in the registry and reports "not configured".

**V1.5** adds: WhatsApp templated delivery, marketing and lifecycle notifications, customer channel
preferences, and dispatcher tuning (retry curves, batching, digest emails).

Templates are typed by event, and every template declares its audience so a customer template can
never be dispatched to a staff recipient or the reverse.

### As built (Phase 8A)

The eight events above ship, split across four modules and one route:

| Piece                                    | What it holds                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/notification`                    | Pure. The template list, `TEMPLATE_AUDIENCE`, `dedupeKeyFor`, the retry curve, the expiry-warning window, recipient parsing. No I/O.                               |
| `lib/email`                              | Rendering and transport. Tables and inline styles, a plain-text alternative for every message, and one `EmailTransport` interface with three implementations.      |
| `server/repositories/notification-*`     | The only module that touches the `notifications` table. Re-exports `NotificationTx` and `NotificationPayload` so a service can join a transaction without Prisma.  |
| `server/services/notification-service`   | Enqueuing (in the caller's transaction) and dispatching (out of band). Holds no business rules — it asks the domain who a template is for and when to retry.       |
| `POST /api/jobs/notifications`           | The scheduler's one door. Bearer `JOBS_SECRET`, compared in constant time; 503 when unconfigured. Every five minutes is enough.                                    |

Eight templates rather than the table's seven names: `quote.expiring` is one row above per
audience, and they are two templates here — `quote.expiring` and `quote.expiring.staff` — because
a flag is how the customer's copy eventually reaches the workshop's inbox.

**Idempotency** is a unique `dedupe_key`, `<template>:<business id>` (plus the address for a staff
row, so two recipients are two deliveries). The writer swallows the unique violation, so enqueuing
the same event twice is one row rather than two e-mails. A sweep that runs every five minutes
across a two-day warning window therefore sends one warning.

**Claiming** is a per-row conditional update — `WHERE id = ? AND status = 'PENDING' AND
scheduled_for <= now`, pushing `scheduled_for` forward by a five-minute lease — the same
compare-and-swap the order and quote transitions use. Two dispatchers running at once each send
every row at most once; a dispatcher that dies mid-batch releases its rows when the lease lapses.

**Retry** is four fixed backoffs (1, 5, 15, 60 minutes) and five attempts, then `FAILED` where a
person can find it and requeue it. An unrenderable row — unknown template, payload that does not
fit it — fails immediately without retry, because it will not become well-formed on its own.

**The two credential e-mails bypass the outbox** and are sent inline. See ADR-026.

**Recipients are never an argument a browser can supply.** A customer e-mail goes to the row's own
address (the order's stored `contactEmail`, the quote owner's account address); a staff e-mail goes
to the `notifications.adminRecipients` setting, with `ADMIN_NOTIFICATION_EMAIL` as a bootstrap for
a deployment where nobody has opened the admin yet. With neither configured a `SKIPPED` row is
written, so an undelivered event is visible rather than silent.

The sweep also runs Phase 10's two lazy expiry sweeps first, so a warning is never sent about a
quote that has already lapsed. Warnings queued during a sweep go out on the next one: dispatch uses
the instant the sweep began.

Not built, and deliberately: the `acceptanceValidUntil` warning in the table above (V1 warns before
`validUntil` only — the acceptance window is short and is enforced lazily on every read), in-app
notification records, and the WhatsApp link generator.

### The homepage is data (Phase 13)

`homepage_sections` rows, ordered by `position` and switched by `isEnabled`, replace what used to
be literals in the page component (ADR-027). Three pieces:

- **`domain/content`** owns ordering, the per-type `config` readers — every one of which returns a
  well-formed default rather than throwing, because `config` is a column a person edits — and the
  declaration of which data each section type needs.
- **`server/services/content-service`** loads the union of those needs **once**, in parallel, so
  the page's query count is a property of what is switched on rather than of how many components
  happen to render. A band that is off issues no query.
- **`app/(storefront)/home-sections.tsx`** renders a band from a row and the loaded data, and does
  no I/O at all.

The trust band's delivery figures come from `shipping_rates` rather than from copy, so a promise on
the front page cannot drift from what the checkout charges. The reviews band renders only approved
reviews and disappears entirely when there are none.

Moderating a review revalidates the affected product's path, so an approval is visible without
waiting out the storefront's five-minute ISR window.

---

## 11A. SEO (Phase 14)

Three modules, and one rule that runs through all of them: **a search engine is told exactly what a
visitor is shown.**

| Piece               | What it holds                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/seo`        | Pure JSON-LD builders. They take a price the pricing domain resolved, an availability the order domain decided and a rating the approved reviews produced. |
| `lib/seo`           | The **only** place a public URL is built, plus the robots directives and the shared `publicPageMetadata`.                                                  |
| `components/seo`    | The `<script type="application/ld+json">` element, and the drawn social card shared by the Open Graph image routes.                                        |
| `app/sitemap.ts`    | Every URL from a repository, behind the storefront's own visibility predicates.                                                                            |
| `app/robots.ts`     | A written-out disallow list. Not access control — see `SECURITY.md` section 10.                                                                            |

**Omission over invention.** `aggregateRating` is absent from a product nobody has reviewed rather
than present with a zero; `sameAs` is absent when no social link is shown; a `BreadcrumbList` with
no trail is no node at all. Structured data that claims something the page does not show is the one
way this feature can do harm, and every builder is written to leave the property out.

**One canonical per thing.** `absoluteUrl` drops the query string, so a filtered listing
canonicalises to its base and every page has exactly one address — no trailing-slash variant, no
`?sort=` duplicate. A `generateMetadata` that cannot find its row returns **no canonical at all**,
so a 404 never advertises itself as the authoritative address of anything.

**A deployment-wide indexing switch.** `SEO_INDEXABLE` gates the site the way a fuse gates a
circuit: off, every public page carries `noindex` and `robots.txt` disallows everything. Phase 18
turns it on. See ADR-028.

**Money, availability and ratings are read, never restated.** The offer's price is formatted from
the same integer `components/commerce/price` renders, with the same number of fraction digits, so
the two cannot disagree — a mismatch there is both a penalty and a lie.

---

## 12. Validation

**Zod, one schema per boundary, defined once and used on both sides.**

```
lib/validation/
├── schemas/       product, order, checkout, custom-request, quote, review, auth, address
├── refinements/   Algerian phone, wilaya code, slug, money
└── parse.ts       parseOrThrow, safeParseAction
```

- Every server action and route handler validates its input before touching a service. Unvalidated
  input never reaches a service; a service can assume its arguments are well-formed.
- Forms use the same schema client-side via `react-hook-form` with a Zod resolver, for feedback
  only. Passing client validation grants nothing.
- Schemas are the source of truth for form field configuration where practical, so a field cannot
  exist in the UI without a server rule.
- Business validity (is this coupon usable, is this variant in stock, is this transition legal) is
  **not** Zod's job — that is the domain layer. Zod validates shape; the domain validates meaning.

---

## 13. Server Actions and API Routes

**Default to server actions.** Use route handlers only where an action cannot work.

| Use a server action for        | Use a route handler for                              |
| ------------------------------ | ---------------------------------------------------- |
| Form submissions and mutations | Payment webhooks                                     |
| Cart operations                | Presigned upload issuance and completion callbacks   |
| Admin CRUD                     | Authenticated file download redirects                |
| Status transitions             | `sitemap.xml`, `robots.txt`, OG images               |
| Quote accept/reject            | Cron endpoints (quote expiry, notification dispatch) |
|                                | Anything a non-browser client must call              |

Every action is wrapped:

```ts
export const acceptQuote = customerAction
  .input(acceptQuoteSchema)
  .rateLimit({ key: 'quote:accept', limit: 10, window: '1m' })
  .handler(async ({ input, actor }) => quoteService.accept(actor, input));
```

The wrapper resolves the session, asserts the role, validates input, applies rate limiting,
catches domain errors and returns a discriminated union `{ ok: true, data } | { ok: false, error }`.
Actions never throw raw errors to the client.

Next.js protects server actions with an origin check by default; this is relied upon but not
treated as the whole CSRF story. See `SECURITY.md` section 13.

### Analytics

A single `track(event, properties)` helper with a typed event union covering the taxonomy in
`PRODUCT.md`. In V1 it writes to the server log and is a no-op client-side. V1.5 persists events
or forwards them to a provider. Defining the taxonomy now costs nothing and prevents the usual
retrofit.

---

## 14. Error Handling

**Typed domain errors, not exceptions as control flow.**

```ts
type DomainError =
  | { code: 'OUT_OF_STOCK'; variantId: string; available: number }
  | { code: 'QUOTE_EXPIRED'; quoteId: string; expiredAt: string }
  | { code: 'INVALID_TRANSITION'; from: string; to: string }
  | { code: 'COUPON_INVALID'; reason: CouponRejection }
  | { code: 'FORBIDDEN' }
  | { code: 'NOT_FOUND' };
```

- Domain functions return `Result<T, DomainError>`. Services translate infrastructure failures
  into domain errors or rethrow as unexpected.
- Every error code maps to user-facing copy in one place, which is also where translation will
  hook in.
- Unexpected errors are logged with a correlation ID, reported to Sentry, and surfaced to the user
  as a generic message plus that ID. Internal details are never returned to a client.
- `error.tsx` boundaries exist per route group; `global-error.tsx` catches the rest.
- **Never** leak whether a resource exists to a user not entitled to it: authorisation failures on
  another customer's resource return `NOT_FOUND`, not `FORBIDDEN`.

---

## 15. Caching and Performance

### Caching layers

1. **CDN / full route cache** — static storefront routes, invalidated by tag on content change.
2. **`unstable_cache` / data cache** — settings, categories, placements, thread colours, shipping
   rates. These are read on almost every request and change rarely. Tagged and invalidated on write.
3. **`React.cache` request memoisation** — the session and settings are resolved once per request
   even when several components need them.
4. **No client-side data cache library in V1.** Server components plus actions cover the needs;
   TanStack Query would be added only if a genuinely interactive client surface appears.

Never cached: cart, checkout, account, admin, signed URLs, anything user-specific.

### Performance budget

| Metric                                      | Budget   |
| ------------------------------------------- | -------- |
| LCP (mobile, product page)                  | < 2.5 s  |
| INP                                         | < 200 ms |
| CLS                                         | < 0.1    |
| Storefront route JS (gzipped)               | < 120 kB |
| Builder route JS (gzipped)                  | < 200 kB |
| Database queries per storefront page render | <= 6     |

Practices: `next/image` everywhere with explicit dimensions and blur placeholders; fonts
self-hosted with `font-display: swap` and preloaded; dynamic imports for the builder preview,
admin tables and dialogs; streaming with Suspense so the shell paints before slow data; no
client-side date or i18n library shipped for formatting the storefront — dates go through
`Intl.DateTimeFormat` with the request's locale (`i18n/format.ts`), and the two dictionaries are
static objects a few kilobytes in size, already in the bundle for the language switcher.

---

## 16. Scalability

The realistic bottlenecks in year one, and where the headroom is.

| Bottleneck                           | Assessment                            | Response                                                              |
| ------------------------------------ | ------------------------------------- | --------------------------------------------------------------------- |
| Read traffic                         | Non-issue at this scale               | Static routes plus CDN                                                |
| Postgres connections from serverless | The real risk                         | Connection pooler (PgBouncer/Neon pooling); Prisma configured for it  |
| Design file storage growth           | Grows without bound                   | Retention policy, per-request file limits, orphan cleanup job         |
| Admin list queries                   | Degrades as orders accumulate         | Keyset pagination, covering indexes, no `count(*)` on hot paths       |
| Product listing N+1                  | Common failure                        | Explicit selects, aggregate ratings denormalised onto the product row |
| Image delivery from Algeria          | Latency-sensitive                     | CDN with EU edge; AVIF/WebP; correct sizes                            |
| Notification sending                 | Blocking a transaction would be fatal | Outbox with an out-of-band dispatcher                                 |
| Long-running jobs                    | Serverless timeouts                   | Cron endpoints doing bounded batches, idempotent                      |

**Constraints preserved for future capabilities** (from `PRODUCT.md` section 12): the payment
interface admits providers; the notification interface admits channels; the storage interface
admits providers; money carries a currency; addresses reference a wilaya table rather than a
string; **user-facing strings are centralised, and since Phase 14.7 two locales are live** — a
third is a dictionary and a line in `LOCALES` (translating catalogue *content* is still a schema
change); the analytics taxonomy exists;
customisation configurations are reusable entities, which is what makes reorder and saved designs
cheap to add later.

Explicitly **not** built for: multi-tenancy, horizontal sharding, event sourcing, a message
broker. Adding any of these speculatively would cost more than the problem they solve.

---

## 17. Project Structure

```
src/
├── app/
│   ├── (storefront)/
│   │   ├── page.tsx
│   │   ├── shop/[[...category]]/
│   │   ├── products/[slug]/
│   │   ├── collections/[slug]/
│   │   ├── custom/
│   │   │   ├── page.tsx
│   │   │   └── builder/[[...draftId]]/
│   │   ├── gallery/
│   │   ├── how-it-works/  about/  faq/  contact/
│   │   ├── size-guide/  care-guide/  privacy/  terms/
│   │   ├── cart/  checkout/  track/
│   │   └── order/confirmation/[token]/
│   ├── (auth)/login|register|forgot-password|reset-password/
│   ├── (account)/account/
│   │   ├── orders/  requests/  quotes/  addresses/  profile/
│   │   └── designs/  wishlist/                      (V1.5)
│   ├── (admin)/admin/
│   │   ├── requests/  quotes/  orders/  products/  categories/
│   │   ├── customers/  reviews/  gallery/  content/  settings/
│   │   └── coupons/                                 (V1.5)
│   ├── api/
│   │   ├── uploads/{presign,complete}/
│   │   ├── files/[id]/                              authorised download redirect
│   │   ├── webhooks/[provider]/
│   │   └── cron/{expire-quotes,dispatch-notifications,cleanup-orphans}/
│   ├── sitemap.ts  robots.ts  opengraph-image.tsx
│   └── layout.tsx  error.tsx  not-found.tsx
│
├── components/
│   ├── ui/            shadcn primitives, restyled
│   ├── layout/        header, footer, nav, drawers
│   ├── storefront/    hero, sections, gallery, trust blocks
│   ├── product/       card, grid, gallery, variant selector, reviews
│   ├── builder/       steps, uploader, placement picker, preview, estimate bar
│   ├── cart/          slide-over, line item, summary
│   ├── checkout/      sections, address fields, payment selector
│   ├── account/       order timeline, quote view, request view
│   ├── admin/         data table, filters, quote editor, status control
│   └── shared/        empty, error, loading, price, status badge, money
│
├── domain/            PURE — no I/O, no framework imports
│   ├── money/  pricing/  cart/  discount/  shipping/
│   ├── quote/  order/  request/  customization/  files/
│   └── errors.ts
│
├── server/
│   ├── actions/       one file per feature; all wrapped
│   ├── services/      orchestration and transactions
│   ├── repositories/  the only Prisma consumers
│   ├── auth/          session resolution, actors, guards
│   └── cache/         tag constants and invalidation helpers
│
├── lib/
│   ├── db/            Prisma client singleton
│   ├── storage/       adapter interface + R2 implementation
│   ├── payments/      provider registry + COD, bank transfer
│   ├── notifications/ channel registry + email, whatsapp stub
│   ├── rate-limit/    adapter + Upstash implementation
│   ├── validation/    Zod schemas and refinements
│   ├── analytics/     track() and the event union
│   ├── seo/           metadata builders, JSON-LD
│   ├── env.ts         validated environment
│   └── utils/
│
├── config/            brand.ts · site.ts · nav.ts · constants.ts
├── styles/            globals.css · tokens.css
└── types/
prisma/                schema.prisma · migrations/ · seed.ts
tests/                 unit/ · integration/ · e2e/
```

### Structural rules

- Nothing outside `server/repositories/` and `prisma/` imports `@prisma/client`.
- Nothing in `domain/` imports from `server/`, `app/`, `lib/` or React.
- Nothing in `components/` imports from `server/services/` or `server/repositories/`.
- `config/brand.ts` plus `styles/tokens.css` are the only places the brand name, logo, colours
  and fonts appear. Replacing the brand is editing two files — it was done in Phase 14.8, when
  STITCH became Bizeora.
- An ESLint boundary rule enforces the first three constraints; they are too important to leave
  to discipline.

---

## 18. Deployment and Operations

- **Environments**: local, preview (per pull request, on a branched database), production.
- **Database**: managed Postgres in an EU region, connection pooling enabled, daily automated
  backups with point-in-time recovery.

### Database connection strategy

Decided in Phase 1 so that Phase 2 cannot accidentally adopt an unsafe pattern. No application
database code exists yet; this is the configuration contract.

**The problem.** Serverless functions scale horizontally without limit, and each instance that
opens its own connection consumes one of the few hundred a Postgres instance allows. A direct
connection from the application exhausts the server under quite modest traffic, and the failure
mode is a site-wide outage rather than a slowdown.

**Two connection strings, with different jobs:**

| Variable | Purpose | Endpoint |
|---|---|---|
| `DATABASE_URL` | Every application query, at runtime | The provider's **pooler** — Neon's pooled endpoint, Supabase's pgBouncer on port 6543, or PgBouncer in transaction mode |
| `DIRECT_URL` | `prisma migrate`, `prisma db push`, introspection | The **unpooled** endpoint, port 5432 |

Migrations need session-level features — advisory locks, `CREATE INDEX CONCURRENTLY`, temporary
tables — that a transaction-mode pooler does not support, which is why the second URL exists and
is not an optimisation.

**Required settings** on `DATABASE_URL`: `pgbouncer=true` (Prisma then disables prepared
statements, which transaction pooling cannot preserve), `connection_limit=1` (each serverless
instance is short-lived and concurrent; a per-instance pool multiplies against instance count),
and `sslmode=require`.

**In the Prisma schema**, from Phase 2:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

**The Prisma client is a module singleton**, cached on `globalThis` in development so hot reload
does not open a new pool on every edit. This is the one place a global is correct.

Both variables are documented in `.env.example`. Neither is validated by `lib/env.ts` yet — a
variable enters the schema in the phase that first reads it (Phase 2).
- **Migrations** run as a deployment step, before the new build receives traffic.
- **Secrets** live in the platform's environment configuration, validated at boot by `lib/env.ts`;
  the application refuses to start with a missing or malformed variable.
- **Cron** (Vercel Cron, authenticated by a shared secret):
  quote send-expiry and acceptance-expiry (hourly) · quote-bound cart invalidation (hourly) ·
  **notification dispatch (per minute, V1)** · orphaned upload cleanup (daily) · expired session
  and token cleanup (daily) · abandoned cart marking (daily, V2).
  Every job is idempotent and processes a bounded batch. Every expiry rule is also evaluated
  lazily on read, so correctness never depends on a job having run.
- **Monitoring**: Sentry for errors with release tracking; structured server logs with a
  correlation ID per request; Vercel Analytics for Web Vitals; an uptime check on the homepage
  and on `/api/health`.
- **Failure modes and behaviour**: storage unavailable — uploads fail with a retryable message,
  the rest of the site works; email provider down — notifications queue in the outbox and retry;
  database unavailable — static storefront routes continue to serve from the CDN while dynamic
  routes show the error boundary; a payment webhook arriving twice is absorbed by idempotency keys.
