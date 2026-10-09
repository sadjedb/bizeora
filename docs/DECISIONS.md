# DECISIONS.md

Architectural and product decisions that were not obvious, that deviate from the original
specification, or that would be expensive to reverse. Routine choices are not recorded here.

All decisions below were made on **2026-09-04** during Phase 0, before any implementation.
They are **Accepted** unless stated otherwise, and each is provisional until code proves it.
Where a later phase revised or extended a decision, the change is recorded as a dated amendment
inside that ADR rather than by editing the original: ADR-006 carries one from Phase 2.3.
Where a later phase reversed part of a decision on new evidence, it is a new ADR that names what
it amends: ADR-019 and ADR-020 came out of Phase 3 installing Better Auth and reading it, and
ADR-021 out of Phase 3.1 acting on what ADR-020 had recorded as a finding. ADR-022 and ADR-023
came out of Phase 8: the first reconciles two rules about when stock is reserved, the second
replaces the read-then-increment identifier Phase 7's audit flagged.

---

# ADR-001: Layered monolith with a pure domain layer

## Status

Accepted

## Context

The application has genuinely complex business logic — two pricing modes, quantity discounts,
per-wilaya shipping, deposits, and three separate state machines — spread across a storefront, a
customer portal and an admin. The original specification asks for centralised business logic but
proposes a directory structure (`lib/`, `server/actions/`, `server/services/`) without saying what
may depend on what. Without an enforced rule, pricing arithmetic ends up in a React component
within weeks, and the admin and the storefront quietly compute different totals.

## Decision

A layered monolith with strictly downward dependencies:
presentation, entry points, services, **domain**, repositories, infrastructure.

`domain/` contains pure TypeScript: no Prisma, no Next.js, no React, no I/O. It holds every
calculation and every state machine. Repositories are the only Prisma consumers. An ESLint import
boundary rule enforces all of this at build time.

## Alternatives

- **Thin controllers with logic in services and Prisma calls inline.** Simplest, and the default.
  Rejected: services doing both orchestration and arithmetic cannot be unit tested without a
  database, so pricing tests become slow and get skipped.
- **Full hexagonal / DDD with aggregates, ports, adapters and a domain event bus.** Rejected as
  over-engineering for a single-store application maintained by one person; the ceremony cost
  exceeds the benefit at this scale.
- **Logic co-located with features (feature-sliced).** Rejected: pricing is used by six features,
  so it has no natural home and would be duplicated.

## Reason

The pure domain layer captures the actual benefit — one testable implementation per rule — at a
fraction of the cost of full DDD. Purity is what makes it enforceable: a lint rule can check
"imports nothing upward", whereas "keep the logic in the service" is only a convention.

## Consequences

- Positive: pricing, totals and transitions are unit tested in milliseconds without a database.
- Positive: an accidental duplicate implementation is visible, because the canonical one is the
  only pure module.
- Positive: the domain layer is portable if a second surface (an API, a mobile client) appears.
- Negative: mapping between Prisma models and domain inputs is real, recurring work.
- Negative: contributors must learn the boundary rules before their first change.

---

# ADR-002: Prisma over Drizzle

## Status

Accepted

## Context

The specification allows either. The schema is large — roughly 45 tables with deep relations,
enums, partial indexes and check constraints — and will be maintained by one person, frequently
with AI assistance.

## Decision

**Prisma**, with raw SQL migrations for the constraints Prisma cannot express (check constraints,
partial unique indexes, GIN indexes).

## Alternatives

- **Drizzle.** Smaller runtime, faster cold starts, SQL-shaped queries, better raw-SQL ergonomics.
  Rejected: its migration tooling is less mature, and the relational query ergonomics on a schema
  this relational cost more day-to-day than the cold-start difference is worth here.
- **Kysely with hand-written migrations.** Best type safety over raw SQL. Rejected: too much
  hand-written plumbing for a solo maintainer.
- **An ORM-free data layer.** Rejected outright at this schema size.

## Reason

Prisma Migrate's workflow — diff, review, apply, reset-and-reseed — is the single biggest
maintainability factor for a schema that will change often in early phases. Prisma's generated
types and documentation are also markedly better understood by AI assistants, which is a real
factor given how this project is built.

## Consequences

- Positive: migrations, seeding and type generation are well-trodden paths.
- Positive: `select` discipline is easy to express, which matters for the DTO boundary.
- Negative: a larger bundle and a slower cold start than Drizzle.
- Negative: some constraints must live in raw SQL migrations, so the Prisma schema is not the
  complete picture. `DATABASE.md` remains the source of truth.
- Negative: connection pooling must be configured deliberately for serverless.

---

# ADR-003: One order pipeline, with the customisation as a shared entity

## Status

Accepted

## Context

The specification says custom orders should be first-class and warns against forcing them into the
normal product/order system "prematurely", proposing `CustomOrder`, `CustomOrderItem`,
`CustomOrderFile` and `CustomOrderOption` alongside `Order` and `OrderItem`. Taken literally this
produces two order systems: two status machines, two admin fulfilment screens, two totals
calculations, two tracking views — and a cart that cannot hold a hoodie and a custom cap together.

## Decision

A **single** `Order` and `OrderItem` pipeline. A line item is either `STOCK` or `CUSTOM`; a custom
line references a `CustomizationConfig`.

`CustomizationConfig` is a first-class entity referenced by cart items, custom request items and
order items alike. The pre-sale artefacts — `CustomRequest` and `Quote` — remain separate, because
they genuinely exist before an order does.

## Alternatives

- **Parallel `CustomOrder` tables as specified.** Rejected: duplicates the entire fulfilment
  system and makes a mixed cart impossible.
- **A JSON `customization` column on the order item.** Rejected: the configuration must be
  queried (which placements sell, which thread colours to restock), validated and reused for
  reorder. `AGENTS.md` explicitly prohibits this pattern.
- **Custom orders as products created on the fly.** Rejected: pollutes the catalogue and breaks
  SEO, search and stock.

## Reason

The custom-versus-stock distinction matters _before_ the sale — pricing, quoting, approval — and
barely matters _after_ it. After the sale both are "make or pick this, then ship it". Splitting
where the difference actually is, rather than at the entity boundary the specification suggested,
removes an entire duplicate subsystem.

Making the configuration a shared entity is what turns reorder, saved designs and hybrid
customisation from features into consequences.

## Consequences

- Positive: one status machine, one admin order screen, one totals pipeline, one tracking view.
- Positive: mixed carts work naturally.
- Positive: reorder and the saved-design library become cheap in V1.5.
- Negative: line-kind checks are needed wherever a line is rendered or priced.
- Negative: `order_items` carries nullable columns that only apply to one kind, constrained by
  check constraints rather than by the type system.
- Negative: configurations must be frozen once referenced by a commitment, which is a service-layer
  rule requiring explicit tests.

---

# ADR-004: Quote states removed from the order status enum

## Status

Accepted

## Context

The specification's order statuses are: Pending, Quote Sent, Quote Accepted, Confirmed, Design
Review, In Production, Ready, Shipped, Delivered, Cancelled. Two of these describe events that
occur before any order exists. An order in "Quote Sent" would be an order with no agreed price, no
payment method and no commitment — a record that is not yet an order.

## Decision

`OrderStatus` contains no quote states. Quoting is modelled by `RequestStatus` on
`CustomRequest` and `QuoteStatus` on `Quote`. An `Order` is created only when a customer checks
out, which for the quote path is after acceptance.

## Alternatives

- **Keep the specification's enum.** Rejected: an order whose price is unknown breaks every
  invariant on the orders table (totals, payment status, stock reservation) and would force those
  columns to be nullable.
- **A single `Transaction` entity spanning enquiry to delivery, with a very long status list.**
  Rejected: one table with three unrelated lifecycles and mostly-null columns.

## Reason

The two lifecycles have different owners, different permissions, different expiry semantics and
different financial meaning. A quote can be superseded; an order cannot. A quote expires; an order
does not. Merging them would mean neither could be constrained properly.

## Consequences

- Positive: `orders` can enforce real invariants — totals are non-null and consistent, every order
  has a payment method.
- Positive: the customer's timeline is clearer: request progress, then order progress.
- Negative: the customer portal has two lists (requests and orders) rather than one, which the UX
  must present coherently. The account overview handles this by merging them into one triage view.
- Negative: converting an accepted quote into an order is an explicit transaction rather than a
  status change.

---

# ADR-005: Guest checkout for stock orders; account required for custom

## Status

Accepted

## Context

The specification describes customer accounts throughout and never mentions guest checkout.
Forced registration is a well-documented conversion killer, and most first-time visitors arriving
from Instagram will not create an account to buy one hoodie. But a quote is a multi-day, multi-step
negotiation that has to live somewhere the customer can return to, and quote acceptance is a
commitment that must be attributable to a verified person.

## Decision

- **Stock-only orders**: guest checkout, no account required. An account is offered after purchase
  with the order details pre-filled.
- **Custom requests and quote-derived orders**: an account is required, created inline at the
  moment of submission, after the estimate has already been shown.
- **The builder** is fully usable anonymously. Identity is requested only at submission.
- **Email is required on every order, guest included.** Phone remains the primary operational
  contact; email carries the order confirmation and is the basis for later claiming.
- Guest orders are claimable later by an account with a matching verified email.
- **The admin customer directory is a logical union** of registered users and distinct guest
  contacts grouped by normalised phone, computed at query time. No separate `Customer` entity is
  introduced. Rows are labelled `Registered` or `Guest` so the two remain distinguishable.

## Alternatives

- **Accounts required everywhere.** Rejected: the largest avoidable conversion loss in the product.
- **Guest everywhere, quotes accessed by a magic link.** Rejected: a forwarded or leaked link would
  expose a customer's design files and contact details, with no revocation path. The security cost
  outweighs the friction saved.
- **Phone OTP instead of an account.** Attractive for this market, but SMS has a per-message cost
  and a delivery-reliability problem in Algeria. Recorded as a V2 option; the schema does not
  preclude it.

## Reason

Friction should be proportional to commitment. Buying a stock item is low-commitment and should be
frictionless. Requesting a quote is the start of a relationship in which the business will invest
real time, and both sides benefit from a durable, authenticated place for it.

## Consequences

- Positive: measurably higher conversion on the shop path.
- Positive: quotes and design files are protected by authentication, not by URL secrecy.
- Positive: requiring email means a confirmation can always be sent, an order can always be
  claimed, and a repeat guest buyer is visible to the admin as one customer rather than three
  unrelated orders.
- Negative: the cart, order and tracking code must handle both an authenticated user and an
  anonymous token throughout.
- Negative: guest-order claiming is an extra flow to build and test.
- Negative: the customer directory is a computed union rather than a table, so it cannot be
  filtered or sorted as cheaply as a real entity. Acceptable at this scale; introducing
  `customerId` on `orders` later is additive with a backfill by phone.
- Negative: **guest purchasers cannot leave reviews** until they claim their order, since a review
  requires an authenticated verified purchaser. Accepted deliberately —
  `BUSINESS-RULES.md` section 11A.4.
- Negative: a customer who submits a request has one moment of friction. It is placed after the
  estimate, which is the least damaging position for it.

---

# ADR-006: Better Auth with database-backed sessions

## Status

Accepted. Amended 2026-09-05 (Phase 2.3) — see the amendment at the end of this ADR, which pins
the version, moves the password hash to the account row, and records the plaintext token-at-rest
trade-off. The original decision and rationale below are preserved unchanged.

## Context

Requirements: email and password, three roles, session checks inside server components, instant
revocation, and a foundation for staff two-factor authentication and possibly phone OTP later.
No social login is needed in V1.

## Decision

**Better Auth** with **database-backed sessions**, wrapped behind `lib/auth/` so the provider is
replaceable.

**Better Auth owns authentication only** — credentials, sessions, email verification, password
reset, and later staff two-factor. Authorisation is a separate concern and stays entirely in the
application:

- Better Auth's **admin and permission plugins are not used**.
- `users.role` is our own column.
- Every permission decision is a pure function in `domain/permissions` over `(actor, resource)`.
- **No Better Auth type appears outside `lib/auth/`**, enforced by the import-boundary lint rule.
  Services, repositories and the domain layer see only our own `Actor` type.

## Alternatives

- **Auth.js (NextAuth) v5.** The largest ecosystem. Rejected primarily because its credentials
  provider steers strongly toward stateless JWT sessions, and stateless sessions cannot be revoked
  instantly — which matters for a compromised admin account or a departing staff member. Working
  against that grain is a recurring source of subtle bugs.
- **Lucia.** The right conceptual model, but the library was deprecated in favour of a
  copy-the-code guide. Rejected on maintenance grounds.
- **A hand-rolled session system.** Genuinely viable — it is a session table, a cookie and Argon2id.
  Rejected because password reset, email verification, rate limiting and (later) two-factor are all
  places where a subtle mistake is expensive, and a maintained library has already made them.
- **A hosted provider (Clerk, Auth0).** Rejected: recurring cost in a price-sensitive market,
  customer records living outside the primary database, and awkwardness in a country where those
  providers have limited presence.

## Reason

Database sessions are a security requirement, not a preference — `SECURITY.md` section 15 makes
instant revocation the first step of incident response. Better Auth supports email/password with
database sessions natively, has first-class roles and two-factor plugins, and does not fight the
App Router.

## Consequences

- Positive: instant session revocation; sessions are visible and auditable.
- Positive: a clear upgrade path to staff two-factor and phone OTP.
- Positive: authorisation is unit-testable without a session, a database or the auth library, and
  replacing the auth provider touches one directory.
- Negative: the roles and permissions the library offers are deliberately left unused, so a small
  amount of work is done by hand that a plugin would have done. That is the price of keeping
  authorisation independent, and it is worth paying.
- Negative: a database read per authenticated request, mitigated by per-request memoisation.
- Negative: a younger library than Auth.js, so fewer answers exist for edge cases. The adapter
  wrapper limits the blast radius of a future migration.

## Amendment — 2026-09-05 (Phase 2.3): version, storage model and the plaintext-token trade-off

The original decision above stands and is not revised. This amendment records what a security
investigation into Better Auth's actual storage model settled, before Phase 3 integrates it. Two
questions were open in the original ADR because they had not been asked: which version, and what
the library actually stores.

### Version and compatibility target

**`better-auth@1.7.2`**, targeted against Node 20.19+, Next.js 16, React 19, Prisma 7 and
PostgreSQL 18. Phase 3 performs a real integration spike against that stack; nothing here assumes
it works without one.

### Password hashing — unchanged requirement, supported mechanism

**Argon2id**, configured through Better Auth's officially supported custom password-hashing
option. The project's Argon2id requirement is intact; only the wiring is now known.

The hash lives on the credential account row — `accounts.password` where
`providerId = 'credential'` — and `users.passwordHash` has been removed. Two columns that could
each hold a password hash is a defect waiting to happen, and the library writes to the account row.

### The decision this amendment exists to record: plaintext tokens at rest

Better Auth stores the **session token in `sessions.token`** and the **verification/reset
credential in `verification.value`** as issued, in plaintext, because it looks both up by equality
on the raw value. **The project accepts this**, with the trade-off stated rather than softened:
someone with read access to those tables can impersonate any logged-in user or complete any
outstanding password reset. Plaintext at rest is worse than hashed at rest. It is not being
described as safe; it is being described as the accepted cost.

**A hashed-token adapter is rejected.** Hashing would mean rewriting reads and writes underneath
the library so that it believes it is comparing a raw value while the adapter compares a digest.
That is not a supported extension point. It would break on any release that changes how sessions
or verifications are queried, and it would break inside an authentication path that keeps
appearing to work — the most expensive kind of failure to notice. An unsupported adapter under the
authentication layer is a larger risk than the exposure it removes.

**Hand-rolling authentication remains rejected**, for the reason the original ADR gives: reset,
verification, throttling and later two-factor are each a place where a subtle mistake is
expensive.

Compensating controls, which are mandatory rather than best-effort: 256 bits of CSPRNG entropy per
token; immediate revocation by row deletion; short verification lifetimes (24 hours for email
verification, 1 hour for reset); Better Auth's atomic single-use consumption, which deletes the
verification row in the operation that reads it; HTTPS with `HttpOnly`, `Secure`, `SameSite=Lax`
cookies; a database that is never publicly reachable, on private networking or an IP allow-list,
with TLS in transit, encrypted backups and a least-privilege application role; and a never-log,
never-serialise rule covering `sessions.token`, `verification.value` and `accounts.password`. The
full list is `SECURITY.md` section 2.1.

### Session lifetime — unchanged

**Customer 30 days, admin 7 days.** Phase 2.3 introduces no new TTL decision. Shortening these is
recorded as an item for the security review that follows the Phase 3 integration, because it is
the cheapest remaining way to cut the window in which a stolen token is useful.

### Schema consequence

`DATABASE.md` section 4 now documents Better Auth's core schema — `users`, `sessions`, `accounts`,
`verification` — as the shape of record, and the old typed `verification_tokens` table is dropped
rather than kept alongside it. Two competing verification systems is the failure mode where one of
them quietly stops being checked. Migration `20260905101500_better_auth_schema` performs the
reconciliation.

Unchanged by all of the above: **authorisation is still entirely ours**. Better Auth's admin and
permission plugins remain unused, `users.role` remains our column, and no Better Auth type leaves
`lib/auth/`.


---

# ADR-007: Generic product options, typed embroidery reference data

## Status

Accepted

## Context

Two modelling questions with opposite answers.

Products need sizes and colours, and the specification insists variants be modelled properly rather
than as one product per combination. But caps are one-size, tote bags have no size, and workwear
adds a fit axis.

Separately, the specification proposes `EmbroideryPlacement` and `EmbroideryColor` entities and
suggests a `CustomOrderOption` table, which reads as a generic entity-attribute-value structure for
embroidery choices.

## Decision

- **Products**: a generic option model — `ProductOption`, `ProductOptionValue`, `ProductVariant`,
  and a join between variants and values.
- **Embroidery**: three small, explicitly typed reference tables — `ThreadColor`,
  `EmbroiderySize`, `EmbroideryFont` — plus `Placement`, all referenced by typed foreign keys on
  `CustomizationConfig`. No EAV.

## Alternatives

- **Fixed `size` and `colour` columns on the variant.** Simpler and adequate today. Rejected: the
  first product with a third axis forces a migration of the whole catalogue.
- **A generic option system for embroidery too.** Rejected: it would make every embroidery
  attribute an untyped string, so the pricing engine could not depend on `embroiderySize.basePrice`
  or on a validated thread-colour count without runtime parsing.
- **Embroidery attributes as enums in code.** Rejected: the specification requires the admin to
  manage them without a deployment.

## Reason

Genericity is worth its cost where the _shape_ varies (product options do) and is a liability
where the shape is known and the values are what vary (embroidery attributes). Thread colours
change constantly; the fact that a configuration has thread colours does not.

## Consequences

- Positive: any product shape is expressible without a migration.
- Positive: embroidery pricing is type-safe and the domain layer can rely on real columns.
- Positive: the admin manages placements, sizes, colours and fonts as data.
- Negative: variant resolution requires a join through the option-value table, and generating
  variants from options is real admin UI work.
- Negative: adding a genuinely new embroidery attribute needs a migration. Judged correct: such an
  attribute would need pricing and validation logic anyway.

---

# ADR-008: Custom orders require a deposit and are not eligible for pure Cash on Delivery

## Status

Accepted

## Context

Cash on Delivery is the dominant payment method in Algerian e-commerce and carries a well-known
refusal rate — the customer declines the parcel at the door and the merchant absorbs both delivery
legs. For stock items that is an annoyance: the goods return to inventory and sell to someone else.
For a hoodie embroidered with a specific business's logo, the goods have **zero** resale value.
The specification does not address this.

## Decision

Any order containing at least one custom line requires a **deposit before production begins**,
default 50%, configurable in settings. The balance may be collected on delivery.

Stock-only orders remain fully COD-eligible. This is expressed once, in the payment provider
registry's `supports()` check, and once in the deposit calculation in `domain/order`.

## Alternatives

- **Full COD on everything, as the market expects.** Rejected: a handful of refused custom orders
  could erase a small shop's monthly margin. This is a business-survival issue, not a preference.
- **Full prepayment for custom orders.** Safest, but a hard sell in a market with low trust in
  online payment and limited payment instruments. Would suppress the highest-value flow.
- **A deposit only above a value threshold.** Reasonable, and reachable later — the deposit
  percentage is a setting, so a threshold rule is a small extension.

## Reason

A deposit aligns risk with the irreversibility of the work. It also filters out non-serious
requests before the owner spends time digitising artwork, which is itself valuable.

## Consequences

- Positive: production is never started on unsecured work.
- Positive: fewer speculative requests, so a cleaner admin queue.
- Negative: some custom customers will not pay a deposit and will be lost. Accepted deliberately.
- Negative: a payment collection method is required before online payment exists. V1 handles this
  with bank/CCP transfer plus manual confirmation by the admin, which is how these businesses
  already work.
- Negative: `Payment` must support multiple payments per order from day one, which the schema does.

---

# ADR-009: Direct-to-storage presigned uploads into a private bucket

## Status

Accepted

## Context

Customers upload design files up to 25 MB from mobile connections. Serverless platforms cap
request bodies well below that (commonly 4.5 MB), and routing large uploads through the application
wastes execution time. The files are the most sensitive asset in the system and must never become
publicly reachable.

## Decision

Presigned direct upload to a **private** S3-compatible bucket, in a two-phase flow: the client
requests a presigned PUT into a `quarantine/` prefix, uploads directly, then calls a completion
endpoint where the server validates the object by its real bytes and promotes it to `designs/`.
All reads are short-lived signed GETs issued after an authorisation check.

## Alternatives

- **Upload through the application server.** Rejected: body-size limits and execution cost.
- **Upload directly to a public bucket with unguessable keys.** Rejected outright. Security by URL
  obscurity, with no revocation, for the asset that matters most.
- **Client-side validation only, with the server trusting the declared type.** Rejected: the
  content type is attacker-controlled.
- **Single-phase upload with validation before the presign.** Rejected: the server cannot inspect
  bytes it has not received, so validation must follow the upload.

## Reason

Two phases with a quarantine prefix mean an unvalidated object is never reachable through the
normal access path, and validation is performed on the actual stored bytes rather than on a claim.
The `PENDING` file status makes an incomplete upload visible and reapable rather than invisible.

## Consequences

- Positive: large uploads work reliably on mobile; the application server never handles file bytes.
- Positive: private files are private by construction, not by configuration discipline.
- Positive: the quarantine step gives malware scanning a natural insertion point in V1.5.
- Negative: a three-call flow (presign, PUT, complete) with more failure modes to design for.
- Negative: orphaned objects require a cleanup job.
- Negative: every read costs a signed-URL round trip, so admin file lists must batch deliberately.

---

# ADR-010: Quotes are immutable once sent, and are versioned

## Status

Accepted

## Context

The specification models a quote with a status but says nothing about revision. In practice, B2B
embroidery quotes are negotiated: the customer asks for 30 pieces instead of 20, or a cheaper
garment. If a sent quote is edited in place, there is no record of what the customer actually saw
when they accepted, which is exactly the record needed when a dispute arises.

## Decision

A quote becomes immutable when it transitions to `SENT`. A revision creates version N+1, linked by
`supersedesQuoteId`, and transitions version N to `SUPERSEDED`. At most one quote per request may
be in `SENT` or `VIEWED`.

**Sending a quote also freezes what it prices.** In the same transaction as the transition to
`SENT`, every `CustomizationConfig` reachable from the quote's request items is frozen: `frozenAt`
is written and the display snapshots (`productNameSnapshot`, `placementLabel`,
`embroiderySizeLabel`, `threadColorNames`, `fontLabel`) are populated. A configuration is therefore
frozen when referenced by an order item **or by any quote in `SENT`, `VIEWED` or `ACCEPTED`**.

A later change — a new file, a different placement, another thread colour — **clones** the
configuration, edits the clone, and prices the clone as version N+1. Version N and the
configuration it described both survive unchanged.

**An accepted quote is not redeemable indefinitely.** Acceptance sets
`acceptanceValidUntil = acceptedAt + settings.custom_orders.acceptanceValidityDays` (default 7).
After that the quote-bound cart is invalidated and the customer is offered an updated quote against
a cloned configuration. The quote itself remains `ACCEPTED` and readable; only its redeemability
lapses.

## Alternatives

- **Mutable quotes with an edit history table.** Rejected: reconstructing what version 1 looked
  like from a diff log is error-prone, and the customer's accepted document must be retrievable
  directly.
- **Cancel and create a wholly new quote.** Nearly the same thing, but loses the negotiation chain
  and makes the customer's list confusing.
- **Mutable while `SENT`, frozen on `ACCEPTED`.** Rejected: a customer could open a quote, decide,
  and find different numbers when they return.

## Reason

An accepted quote is a commercial commitment. Its integrity is worth one extra table relationship,
and versioning makes the negotiation legible to both sides.

## Consequences

- Positive: what the customer accepted is retrievable, exactly, forever — the lines, the totals,
  **and the configuration those lines described**.
- Positive: the negotiation history is visible to the admin.
- Positive: an accepted-but-unpaid quote cannot be redeemed at an obsolete price months later.
- Negative: the customer's quote list must present versions coherently rather than as separate
  quotes; the UI groups them under the request.
- Negative: the "at most one active quote per request" rule requires enforcement in the service
  layer and a test.
- Negative: freezing at send means a customer correcting a typo in their instructions after a
  quote is sent triggers a clone and a new quote version. Judged correct: a change to what is
  being made is a change to what was quoted, and the admin should see it.
- Negative: cloning creates configuration rows that are never ordered. They are small, and
  `clonedFromConfigId` keeps the lineage legible.

---

# ADR-011: A static design-on-product preview ships in V1

## Status

Accepted

## Context

The specification places design preview in V1.5 and describes an eventual mockup system. The
builder's review step is the moment of maximum doubt: the customer is about to commit money to
something they cannot see. Every other reassurance in the flow — photography, reviews, guarantees
— is generic; this one is about _their_ design.

## Decision

Ship a **static overlay preview** in V1, scoped to **raster uploads only**.

- **PNG and JPG/JPEG**: the uploaded image is composited onto the product photograph client-side,
  at the selected placement's anchor, scaled to the selected embroidery size, with a visible
  label — "Indicative preview, not a stitch simulation."
- **SVG and PDF**: accepted as uploads under the normal rules, but **no visual preview**. The
  review step shows the file card, the full configuration summary, and an explicit
  "Visual preview is not available for this file type" note.
- The preview updates **from the placement step onward**, not only at review, so changing the
  placement changes the picture — which is the moment the preview earns its value.

Anchors are stored in `product_image_placement_anchors` as percentages of image dimensions
(`xPercent`, `yPercent`, `widthPercent`, `rotationDeg`) per `(productImageId, placementId)`. The
overlay is a CSS transform over a signed image URL: **no server-side image processing on the
preview path at all**. No warping, no fabric simulation, no thread rendering. Those remain V2.

## Alternatives

- **Defer all preview to V1.5, as specified.** Rejected: the cost is a few hours against the
  highest-doubt moment in the funnel.
- **A photorealistic mockup with displacement mapping in V1.** Rejected: substantial work, needs
  per-product mesh data, and risks setting an expectation the finished embroidery cannot meet.
- **No preview ever; rely on the file thumbnail.** Rejected: a thumbnail shows the file, not the
  product.
- **Preview for all four accepted file types, via server-side rasterisation.** Rejected, and this
  is the change from the original form of this decision. SVG rasterisation is tractable, but PDF
  rasterisation needs a heavy native dependency (pdfium, MuPDF or Ghostscript) that is awkward on
  serverless and adds decoding attack surface to a format `SECURITY.md` section 6 deliberately
  treats as opaque. That is not "a few hours of work", and it buys a preview for the minority of
  uploads.

## Reason

The reassurance value is almost entirely in "roughly this size, roughly here, on this garment".
Getting from nothing to that is cheap; getting from that to photorealism is expensive and adds
comparatively little to the purchase decision — while raising the risk of a customer expecting a
render they will not receive.

## Consequences

- Positive: directly addresses the biggest hesitation in the core flow.
- Positive: gives the V2 mockup system a defined interface to replace.
- Positive: **no image-processing dependency on the preview path.** `sharp` is still needed for
  product imagery and blur placeholders, but the preview does not depend on it, and no PDF
  rasteriser enters the stack.
- Negative: placement anchor coordinates must be captured per product image in the admin, which is
  extra data entry. Sensible defaults per placement reduce it to an adjustment rather than an
  entry task.
- Negative: business customers, who most often upload SVG or PDF, get no preview — precisely the
  segment with the most at stake. Mitigated by a clear explanation and by the fact that they are
  also the segment most able to judge a logo without one. Revisit in V1.5 with SVG-only
  rasterisation if it proves to matter.
- Negative: an over-flattering preview creates expectation risk, mitigated by the explicit label
  and by conservative scaling.

---

# ADR-012: Money as integer minor units

## Status

Accepted

## Context

DZD is in practice quoted in whole dinars. It would be tempting to store prices as integer dinars,
or as a decimal type. Both invite defects: floating-point arithmetic on decimals, and a currency
model that cannot express a subunit if the business ever prices in one or adds a market that does.

## Decision

All money is stored as an **integer count of minor units** (centimes) with an ISO currency code,
in a branded `Money` type. No floating-point arithmetic on money anywhere. Rounding occurs at two
defined points only — percentage discounts and percentage deposits — using half-up.

## Alternatives

- **`numeric(12,2)` in Postgres.** Correct in the database, but the value crosses into JavaScript
  as a string or a `Decimal` object, and every consumer must remember not to coerce it. One
  `Number()` is a silent rounding bug.
- **Integer dinars, no subunit.** Simpler today. Rejected: percentage discounts and deposits then
  round at every step, compounding error, and a second market would require a migration of every
  money column.
- **A decimal library throughout.** Rejected: a dependency and a performance cost to solve a
  problem that integers solve for free.

## Reason

Integers make money arithmetic exact and rounding explicit, and the currency code carried alongside
prevents adding amounts across currencies — a class of bug that is easy to write and hard to
notice.

## Consequences

- Positive: no floating-point money defects are possible.
- Positive: rounding is visible in exactly two places and is unit tested.
- Negative: every display path must divide and format; every admin input must multiply. Both are
  handled by shared helpers, and forgetting one is a factor-of-100 error that is immediately
  obvious in testing.
- Negative: seed data and fixtures must be written in centimes, which reads oddly.

---

# ADR-013: Business configuration in a database settings table

## Status

Accepted

## Context

The specification lists many values that must be adjustable by the owner: brand name, contact
details, WhatsApp number, shipping fees, free-shipping threshold, quote expiry, deposit
percentage, custom-order thresholds, notification preferences. The owner is not a developer and
must not need a deployment to change a delivery fee.

## Decision

A single typed `settings` key–value table, read through a cached accessor with typed getters,
grouped by domain (`brand`, `contact`, `shipping`, `payments`, `custom_orders`, `notifications`,
`seo`, `features`). Shipping rates, being genuinely relational, live in their own zone and rate
tables rather than in settings.

**Secrets never live here.** API keys and credentials remain in environment variables.

## Alternatives

- **Constants in code.** Rejected: every change becomes a deployment, which for this owner means
  it never happens.
- **Environment variables.** Rejected: requires a redeploy, is invisible to the owner, and cannot
  be edited from the admin.
- **A typed settings table per group.** Rejected: eight tables and eight admin screens for what is
  a flat list of values.
- **A single JSON settings document.** Rejected: no per-key typing, no per-key audit of who changed
  what, and concurrent edits overwrite each other.

## Reason

One table, typed accessors and a cache give the owner control without giving up type safety at the
call site or auditability of changes. Keeping shipping rates relational preserves the constraint
that one wilaya maps to exactly one zone, which a settings blob could not enforce.

## Consequences

- Positive: the owner controls pricing thresholds, deposits, quote validity and contact details.
- Positive: feature flags for dark-shipped V1.5 work come free.
- Positive: setting changes are audit-logged.
- Negative: settings are a cached database read on nearly every request; the cache must be
  invalidated correctly on write, which is a real source of subtle bugs.
- Negative: a typed accessor must exist per key, and a missing key must fail loudly rather than
  defaulting silently to zero — a zero-valued deposit percentage would be a serious defect.

---

# ADR-014: SVG uploads are accepted, sanitised, and never rendered inline

## Status

Accepted

## Context

The specification lists SVG among accepted upload formats. SVG is an XML document that can contain
scripts, external references, entity expansions and remote image references. Accepting arbitrary
SVG and rendering it is a direct path to stored cross-site scripting — and the audience for that
payload would be the business owner, in the admin, with full privileges.

The countervailing fact: logos arrive as SVG. It is the correct format for embroidery digitising,
and the customers most likely to supply one — businesses ordering branded workwear — are the
highest-value segment.

## Decision

Accept SVG, with three controls applied together:

1. **Sanitise on ingest**, server-side: strip scripts, event handlers, foreign objects, external
   references and entity declarations; disable external entity resolution at the parser. Store the
   sanitised form.
2. **Never render inline.** An uploaded SVG is never injected into the DOM and never used as an
   image source on any page carrying session cookies. All previews are server-generated rasters.
3. **Serve as an attachment**, from the private bucket, with `Content-Disposition: attachment`,
   `Content-Type: application/octet-stream` and `nosniff`.

The same attachment treatment applies to PDFs.

## Alternatives

- **Reject SVG entirely.** Safest. Rejected: it would push the highest-value customer segment back
  to WhatsApp, which is the exact behaviour the platform exists to replace.
- **Accept SVG but convert to PNG on upload and discard the original.** Rejected: the vector
  original is what the embroidery digitising software needs; discarding it destroys the file's
  value.
- **Sanitise only, and render previews inline.** Rejected: sanitisers are bypassed periodically,
  and a single bypass would execute in an admin session.

## Reason

The three controls are defence in depth, and the third is the one that holds even if the first
fails: a file that is only ever downloaded, from a foreign origin, with a non-renderable content
type, cannot execute in the application's context regardless of what it contains.

## Consequences

- Positive: business customers can supply logos in the correct format.
- Positive: a sanitiser bypass alone is not sufficient for compromise.
- Negative: SVG previews require server-side rasterisation, which is additional processing and a
  dependency.
- Negative: the admin cannot preview an SVG in the browser at all. V1 generates no raster preview
  for SVG or PDF (ADR-011), so both are represented by a file card and are downloaded to be
  worked with. Accepted as the correct trade.

---

# ADR-015: Quote-bound carts, and a `FEE` line kind

## Status

Accepted

## Context

Two defects surfaced in the pre-Phase-1 review, both in the seam between an accepted quote and an
order.

First, `LineKind` was `STOCK | CUSTOM`, so an order item required either a variant or a
customisation. But `QuoteLineKind` includes `SETUP_FEE`, `DIGITIZING` and `RUSH_FEE` — charges
levied once per job, with neither a product nor a customisation. The original specification's own
worked example is _Hoodie x3 9,000 / Embroidery 3,000 / Setup fee 500 / Delivery 600_. On
acceptance those fees had nowhere to go: they would have to be folded into a unit price, destroying
the itemisation the customer approved, or dropped, leaving the order unable to reconcile with the
quote.

Second, acceptance pushed quote lines into the customer's existing shopping cart. That cart then
resolved shipping from the wilaya rate table, while the quote had already priced delivery as a
`SHIPPING` line. A customer who added anything else would be charged delivery twice and would
check out at a total that was not the total they accepted.

## Decision

**Add `FEE` to `LineKind`.** A fee line carries `nameSnapshot`, `feeKind`, `unitPrice`,
`quantity = 1`, and no product, variant or customisation. `SHIPPING` quote lines map to
`orders.shippingTotal` and `DISCOUNT` quote lines to `orders.discountTotal`, so the order-total
invariant continues to hold. The full mapping is `BUSINESS-RULES.md` section 2.6.5.

**Accepting a quote creates a dedicated quote-bound cart** (`carts.kind = 'QUOTE_BOUND'`),
separate from the customer's standard cart. It contains exactly the quote's lines and nothing
else: no additions, no quantity edits, no coupons. Quote shipping supersedes rate resolution. The
deposit is copied from the quote. At placement the reconstructed total must equal
`quote.grandTotal` exactly, or placement fails.

The standard shopping cart is untouched and remains fully usable alongside it.

## Alternatives

- **Fold fees into unit prices at acceptance.** Rejected: the customer's order confirmation would
  itemise differently from the quote they approved, which is exactly the discrepancy that produces
  disputes with business customers.
- **A separate `order_charges` table for order-level fees.** Viable and arguably tidier. Rejected
  because fees would then be invisible to every renderer, exporter and total that iterates order
  items, and each would need teaching about a second source of money.
- **Allow mixing quote lines into the standard cart, with a rule that quote shipping wins.**
  Rejected: exclusivity becomes a convention enforced in several places rather than a structural
  property, and quantity edits on a quoted line would still be reachable.
- **Convert an accepted quote straight to an order, skipping the cart.** Attractive, and it removes
  the problem entirely. Rejected because checkout is where the delivery address, delivery type and
  payment method are collected; duplicating that outside the cart means two checkouts to maintain.

## Reason

An accepted quote is a fixed commercial commitment; a cart is a mutable working set. Modelling the
first as the second is the underlying error, and both defects follow from it. Giving a quote its
own cart makes exclusivity structural — enforced by check constraints and a partial unique index —
rather than a rule someone must remember. The `FEE` line kind then lets the commitment survive
into the order without loss of detail.

## Consequences

- Positive: an order built from a quote reconciles to the accepted total exactly, and that equality
  is asserted at placement rather than assumed.
- Positive: setup, digitising and rush charges appear on the order confirmation exactly as they
  appeared on the quote.
- Positive: double-charged shipping is structurally impossible on a quote-derived order.
- Negative: `LineKind` gains a third branch, so every line renderer, the totals pipeline and two
  check constraints must handle it.
- Negative: a customer may hold several active carts at once, which the account UI and the cart
  indicator must present without confusion.
- Negative: quote-bound carts need their own expiry handling (ADR-010) and their own empty and
  invalidated states.

---

# ADR-016: Historical fidelity for customisations and shipping

## Status

Accepted

## Context

Order items already snapshot the product name, variant label, SKU and image, so a deleted or
renamed product cannot corrupt an order's display. The same protection was missing in two places.

A frozen `CustomizationConfig` referenced `placements`, `embroidery_sizes`, `thread_colors` and
`embroidery_fonts` by foreign key. Freezing prevented editing the configuration, not the rows it
pointed at. An admin renaming "Small" to "Petit", adjusting a size's millimetre range, or
deactivating a thread colour would silently change how every historical order and quote reads.

Separately, `orders.shippingTotal` was snapshotted, so a rate change could not alter a placed
order's charge — but nothing recorded _which_ rate had applied, so a later question about a
delivery charge was unanswerable once the rate table had been edited.

## Decision

**Display snapshots on `customization_configs`**, written at freeze time and never afterwards:
`productNameSnapshot`, `placementLabel`, `embroiderySizeLabel`, `threadColorNames` (ordered array)
and `fontLabel`.

An unfrozen configuration renders from the live reference tables. A frozen configuration renders
from its snapshots only. Foreign keys are retained for reporting.

**Reference data is deactivated, never deleted.** `placements`, `embroidery_sizes`, `thread_colors`
and `embroidery_fonts` are soft-deleted via `isActive = false`; the admin UI offers only
"deactivate".

**Orders record their shipping rate**: `shippingRateId` (nullable, `ON DELETE SET NULL`) for
reporting, and `shippingRateLabel` as an immutable snapshot.

## Alternatives

- **Soft-delete alone.** Rejected: it survives deletion but not renaming or re-pricing, and a
  rename is far more likely than a deletion.
- **Never allow reference data to be edited.** Rejected: the specification requires the admin to
  manage placements, sizes, colours and fonts, and correcting a typo must not be forbidden.
- **A JSON snapshot blob on the configuration.** Rejected: five typed columns are queryable,
  constrainable and legible, and `AGENTS.md` prohibits JSON where the structure is known.
- **Reconstruct history from an audit log of reference-table edits.** Rejected: replaying a change
  log to render an old order is fragile and expensive, and would be reached only when someone was
  already investigating a discrepancy.

## Reason

An order and an accepted quote are records of what a customer bought at a price they agreed. That
guarantee has to cover the description as well as the number, or it is only half a guarantee. The
design already accepted this reasoning for products; extending it to customisations and shipping is
consistency, not new philosophy.

The timing matters more than the design. Once reference rows have been edited, the original labels
no longer exist anywhere and cannot be backfilled. This is the one finding in the review that
becomes permanently unrecoverable rather than merely more expensive.

## Consequences

- Positive: an order or quote reads a year later exactly as the customer saw it.
- Positive: a historical delivery charge stays explainable after the rate table changes.
- Positive: the admin can rename and re-price reference data freely, which is what makes it safe to
  let them manage it at all.
- Negative: five columns of duplicated data on every frozen configuration. Negligible at this
  scale, and the duplication is the point.
- Negative: two rendering paths, live and frozen, which must be covered by tests — a bug that read
  the reference tables for a frozen configuration would be silent.
- Negative: `threadColorNames` as an ordered array must be kept consistent with the
  `customization_thread_colors` join at freeze time, in one transaction.

---

# ADR-017: Quantity discount tiers live in a table, not in settings

## Status

Accepted

## Context

`BUSINESS-RULES.md` section 2.5 defines quantity discount tiers (1–9 → 0%, 10–24 → 5%, 25–49 →
10%, 50+ → 15%) and described them as "settings data". The pre-Phase-2 decision gate found that
`DATABASE.md` defined **no storage for them at all** — no table, and no key in the settings list.
The `settings` table's `SettingType` includes `JSON`, so a single JSON row was available and would
have been the path of least resistance.

Tiers are ordered numeric ranges with a constraint that matters — they must not overlap and must
cover every quantity — and the admin edits them.

## Decision

A dedicated **`discount_tiers`** table: `minQuantity`, `maxQuantity` (nullable for the open-ended
top tier), `discountBasisPoints`, `label`, `isActive`, with check constraints on the bounds and
the percentage range. The four documented tiers are seeded in Phase 2. Non-overlap and full
coverage are validated over the active set on write and asserted by test.

## Alternatives

- **A JSON row in `settings`.** One row, no migration, trivially editable as a blob. Rejected:
  `AGENTS.md` section 7 and `DATABASE.md` section 16 both restrict JSON to data that is never
  queried, constrained or reported on, and tiers fail all three tests. A JSON blob also cannot
  express "these ranges do not overlap" to anything but hand-written code, and gives the admin a
  textarea instead of a form.
- **Hard-coded tiers in `domain/discount`.** Rejected: the owner must be able to change a discount
  without a deployment, which is the whole point of the settings layer.
- **A Postgres exclusion constraint over an integer range type**, enforcing non-overlap in the
  database. Genuinely the strongest option and deliberately left open. Rejected for V1 because the
  admin edits tiers as a set, and validating the set produces a far better error message than a
  constraint violation on one row; the check constraints still catch malformed individual rows.

## Reason

This is the project's own JSON rule applied consistently. Structured, ordered, constrained,
admin-edited data belongs in a table — and the cost of getting it wrong is asymmetric: moving from
a JSON blob to a table later is a migration plus a rewrite of the admin screen, while a table that
turns out to be overkill costs four rows.

## Consequences

- Positive: tier selection is a query, the constraints are real, and the admin gets an ordinary
  CRUD screen.
- Positive: a quantity matching no tier is detectable, so the domain function can return a typed
  error instead of silently discounting nothing.
- Negative: one more table and one more admin screen than a settings row would have needed.
- Negative: non-overlap is a service-layer invariant in V1 rather than a database guarantee, so it
  depends on a test continuing to exist. The exclusion-constraint upgrade path is recorded.

---

# ADR-018: Percentages are integer basis points

## Status

Accepted

## Context

The decision gate found two coexisting percentage conventions in `BUSINESS-RULES.md`. Coupons
computed `eligibleSubtotal * value / 10000` — basis points. The deposit computed
`grandTotal * settings.custom_orders.depositPercent` — which is only correct if the setting holds a
fraction such as `0.5`. Both formulas were written as authoritative, in the same document, for the
same kind of calculation.

A fraction is a float, and ADR-012 prohibits floating-point arithmetic on money. Two conventions
also make the unit unknowable from the value: `50` could mean 50%, 0.5% or 5000%, and the failure
would be silent and financial.

## Decision

**Every percentage that participates in a business calculation is an integer count of basis points
(10 000 = 100%).** Fractional representations are prohibited in configuration, in the database and
in domain function signatures.

One conversion, used everywhere a percentage meets money:

```
applyBasisPoints(amount, basisPoints) = roundHalfUp(amount * basisPoints / 10000)
```

Applies to `settings.custom_orders.depositPercent` (seeded `5000`),
`discount_tiers.discountBasisPoints`, `coupons.value` when `type = PERCENTAGE`, and
`settings.custom_orders.estimateBandPercent` (seeded `1500`). Fields carry a `BasisPoints` suffix
or are documented as basis points where they are defined.

## Alternatives

- **Decimal fractions (`0.5`).** The most readable form. Rejected: it is a float, which ADR-012
  prohibits on money, and it reintroduces exactly the rounding class of bug that integer minor
  units were chosen to eliminate.
- **Whole-number percents (`50`).** Simple and readable. Rejected: no sub-percent precision, so a
  7.5% tier would need a schema change, and `50` is ambiguous next to a basis-point field.
- **A `Percentage` value object wrapping either representation.** Rejected as ceremony: the problem
  is a missing convention, not a missing type. Basis points plus a naming rule solves it at no
  runtime cost.

## Reason

Integers keep percentage arithmetic exact and rounding explicit, consistent with ADR-012. Basis
points express one tenth of a percent without a decimal, which exceeds anything this business will
need. Most importantly it is *one* convention: the coupon rule already used it, so this makes the
deposit consistent with the codebase rather than the reverse.

## Consequences

- Positive: one conversion function, unit tested once, used by every percentage calculation.
- Positive: the unit is legible in the value — `5000` cannot be mistaken for a fraction.
- Positive: `BUSINESS-RULES.md` no longer contains two contradictory deposit formulas.
- Negative: admin inputs must convert on write and display on read (an admin types `50`, the
  database stores `5000`). One shared form control, and getting it wrong is a factor-of-100 error
  that is immediately visible in testing.
- Negative: seed data and fixtures read less naturally, the same trade already accepted for money
  in minor units.

---

# ADR-019: `accounts.issuer` is kept, NOT NULL, and is the account identity key

## Status

Accepted — 2026-09-05, Phase 3.

## Context

Phase 2.3 modelled the four Better Auth tables from research rather than from the installed
package, and left one question open for this phase to answer: does `accounts.issuer` earn its
place, or was it copied from an OAuth-shaped example into a project that has no OAuth in V1?

Phase 3 answered it by reading `better-auth@1.7.2` itself — its table definitions in
`@better-auth/core/db/get-tables`, and every call site that touches an account row.

## Decision

**Keep `issuer`, make it `NOT NULL`, and move the account's unique key from
`(providerId, accountId)` to `(issuer, accountId)`.**

Three findings, all from the installed source rather than from documentation:

1. `issuer` is declared `required: true` in Better Auth's own account table definition. It is not
   an OAuth extra.
2. It is load-bearing for email and password, which is the only provider V1 has.
   `internalAdapter.updatePassword` filters on
   `userId + providerId + issuer + accountId`. A credential row with a NULL issuer matches zero
   rows, so **the password change and the password reset would both silently do nothing** — an
   update that reports success and changes no password is the worst available failure.
3. Better Auth declares the unique index as `(issuer, accountId)`. The synthetic values
   `local:<provider>` and `local:oauth:<provider>` are what keep a local provider id from
   colliding with an OAuth one; a unique index on `(providerId, accountId)` enforces a different
   constraint from the one the library relies on.

Credential rows therefore carry `providerId = 'credential'` and `issuer = 'local:credential'`.

## Alternatives

- **Drop the column**, as Phase 2.3 half-expected. Rejected on the evidence above: it would break
  password changes and resets, and the failure is silent.
- **Keep it nullable.** Rejected. Nullable means "some credential rows will not be updatable", and
  the only thing distinguishing those rows would be which code path happened to create them.
- **Keep the `(providerId, accountId)` index as well.** Rejected as a second constraint that says
  something the library does not mean, and that would reject a legitimate row the day a second
  local provider is added.

## Reason

The column is not decoration and the index is not a detail: both are part of how Better Auth
identifies a credential. Phase 2.3 could not have known that without installing the package, which
is exactly why Phase 3's brief required verifying behaviour rather than trusting the research.

## Consequences

- Positive: password change and password reset work, and are covered by a test that signs in with
  the new password rather than only asserting that the hash changed.
- Positive: adding an OAuth provider later needs no migration and cannot collide with the
  credential account.
- Negative: a schema correction one phase after the schema was locked. The tables were empty, so
  the migration is a `SET NOT NULL` and an index swap with no backfill — the cost of finding this
  in Phase 3 rather than after launch is close to zero, which is the argument for integration
  spikes happening before dependent work.
- The two Phase 2.3 database tests that asserted the old shape now assert this one.

---

# ADR-020: Password-reset tokens are hashed at rest; session tokens are not

## Status

Accepted — 2026-09-05, Phase 3. Amends the Phase 2.3 amendment to ADR-006 in part.

> The email-verification half of this ADR is **superseded by ADR-021**. What it records below —
> that 1.7.2 issues verification as a stateless, replayable JWT — was true of the default flow and
> is why Phase 3.1 replaced it with a one-time code. The reset-token and session-token decisions
> here stand unchanged.

## Context

Phase 2.3 accepted plaintext storage for **both** session tokens and verification tokens, on the
stated grounds that hashing them would require rewriting reads and writes underneath Better Auth
— an unsupported extension point that would break silently inside an authentication path. That
reasoning was sound, and it rested on a factual premise: that no supported mechanism existed.

Phase 3 installed the package and read it. For verification tokens, the premise is false.

## Decision

**Enable `verification.storeIdentifier: "hashed"`. Leave session tokens stored as issued.**

The two are separated because the library treats them differently, not because the project changed
its mind about one and not the other.

**Verification and reset tokens — now hashed.** A reset token is stored in
`verification.identifier` as `reset-password:<token>`, and `storeIdentifier` is Better Auth's own
first-class option: it SHA-256s the identifier on write and applies the same transformation on
lookup, with a plain-identifier fallback for rows written before it was enabled. This is a
documented configuration value, not an adapter rewrite. It is precisely the supported mechanism
ADR-006 said it would adopt if one existed, so the Phase 2.3 position is amended rather than
contradicted. A `verification` row is no longer a usable credential.

**Session tokens — still stored as issued.** Better Auth looks a session up by equality on the raw
`sessions.token`, and there is no supported option to change that. The Phase 2.3 reasoning applies
here unchanged and in full: an unsupported hashing adapter under the session lookup is a larger
risk than the exposure it removes. `SECURITY.md` section 2.1 continues to describe this as an
accepted trade-off, and it is still not described as ideal.

**Email verification is a third case, and stores nothing.** Verified against the installed source:
1.7.2 issues email-verification links as a stateless HS256 JWT signed with `BETTER_AUTH_SECRET`,
and writes no `verification` row at all. There is nothing at rest to hash — and, as the
consequence below records, nothing that makes it single-use either.

## Alternatives

- **Keep both plaintext**, as Phase 2.3 briefed. Rejected once the premise was known to be false:
  shipping a knowingly weaker posture than a one-line supported option provides is not a trade-off,
  it is an oversight preserved by inertia.
- **Hash session tokens too, via a custom adapter.** Rejected, again, and for the original reason.
  The distinction that matters is supported versus unsupported, not hashed versus plaintext.

## Reason

`SECURITY.md` section 2.1 states the cost of plaintext tokens plainly: read access to those tables
lets an attacker complete any outstanding password reset. Removing half of that exposure costs one
configuration value and no custom code, so the only remaining question was whether the mechanism
was supported. It is.

## Consequences

- Positive: database read access no longer yields usable reset tokens. The compensating controls in
  `SECURITY.md` section 2.1 still apply; there is simply less left for them to compensate for.
- Positive: no custom code was added to reach it, so nothing new can break on a library upgrade.
- Negative: a reset row can no longer be matched to a customer by reading the table, which makes
  support debugging harder. That is the intended effect.
- Negative, and the more important one: **email verification links are replayable until they
  expire.** Being a stateless JWT, the token is not consumed on use — following the same link twice
  succeeds twice, and `SECURITY.md`'s previous claim that verification was "single-use" was wrong
  about this flow. Single use is real for password reset, where Better Auth's
  `consumeVerificationValue` deletes the row in the operation that reads it. The 24-hour
  verification window and the replay property are recorded in `SECURITY.md` section 2.1 and listed
  for the post-Phase-3 security review alongside the session-lifetime question.


---

# ADR-021: Email verification is a one-time code, not a link

## Status

Accepted — 2026-09-05, Phase 3.1. Supersedes the email-verification half of ADR-020.

## Context

ADR-020 recorded, as a finding rather than a choice, that Better Auth 1.7.2 issues its
email-verification link as a stateless HS256 JWT: nothing is written to the database, so nothing
can be consumed, and **the same link verifies the address as many times as it is presented until
it expires**. `SECURITY.md` had described verification as single-use, which was wrong.

It was listed as the weakest item on that page and left for the post-Phase-3 security review. The
review is this phase, and the conclusion is that it should not ship as it was.

The exposure is narrow but real: a verification link is a bearer credential that lives in a
mailbox, in forwarded mail, and in whatever logs sit between the sender and the recipient. Being
replayable for a full day means anyone who obtains it later can re-assert ownership of the address
— and `emailVerified` is what will gate quote acceptance, which is a commercial commitment.

## Decision

**Replace the verification link with Better Auth's `emailOTP` plugin, using
`overrideDefaultEmailVerification: true`.** This is the library's own switch for exactly this
substitution, not a workaround.

The verification credential becomes an 8-digit code, and the flow becomes stateful and consumable:

| Property        | Configuration                    | Mechanism                                                                                      |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Single use      | —                                | `atomicVerifyOTP` consumes the row through `consumeVerificationValue`, which deletes it in the operation that reads it, and does not recreate it on success |
| Replay          | —                                | A replayed code finds no row and is rejected                                                    |
| Expiry          | `expiresIn: 900`                 | 15 minutes, down from the JWT's 24 hours. Expired rows are deleted on sight                     |
| Guessing        | `allowedAttempts: 3`             | Three wrong codes leave the row consumed rather than recreated, locking the identifier out      |
| Request flooding| `rateLimit: { window: 60, max: 3 }` | Applies where Better Auth's rate limiting is active, which is production by default          |
| At rest         | `storeOTP: 'encrypted'`          | Symmetric encryption under `BETTER_AUTH_SECRET`                                                 |
| Identifier      | `verification.storeIdentifier: 'hashed'` (already set) | The identifier is `email-verification-otp-<address>`, so hashing also keeps the address out of the table |

**`storeOTP: 'encrypted'` rather than `'hashed'`, which is the opposite of the reset token, and
deliberately so.** A reset token carries ~143 bits of entropy, so a SHA-256 digest of it is
irreversible in practice. An 8-digit code carries ~27 bits: anyone holding the digest recovers the
code by trying all 10^8 candidates, which is milliseconds of work. Hashing a low-entropy credential
looks like protection and is not. Encryption is, because `BETTER_AUTH_SECRET` lives in the secret
store rather than in the database, so database read access alone does not yield the code.

**No `emailVerification.sendVerificationEmail` may be defined in our own options.** The plugin
supplies one through its `init`, and `runPluginInit` merges with `defu(userOptions, pluginOptions)`
— which gives *our* value precedence. Defining one would silently win, restore the JWT link, and
leave `overrideDefaultEmailVerification` doing nothing whatsoever. This is the failure mode most
likely to be reintroduced by a well-meaning edit, so a test asserts that sign-up produces a code
and no link.

## Alternatives

- **Leave it, and rely on the 24-hour window.** Rejected: it is a bearer credential with no
  consumption, and the fix is a supported plugin already in the package.
- **Shorten the JWT's `expiresIn` instead.** Rejected as mitigation mistaken for a fix. A
  15-minute replayable credential is still replayable, and it trades the security problem for a
  usability one, since email is not always prompt.
- **Store the JWT's `jti` and consume it.** This is the "parallel verification table" the phase
  brief prohibits, and rightly: it is a second verification system running beside the library's,
  and the one that stops being checked is always the one nobody wrote a test for.
- **A hashed random link token of our own.** Same objection, plus it is hand-rolled
  authentication, which ADR-006 rejects on principle.
- **`storeOTP: 'hashed'`.** Rejected for the entropy reason above.

## Reason

The mechanism is first-party, the switch is a documented option, the storage question has a
supported answer, and the result is genuinely single-use rather than nominally so. Nothing was
hand-rolled, no schema changed, and the `verification` table the library already owns is the only
place state lives.

## Consequences

- Positive: verification is single-use, replay-rejecting, attempt-limited and expiring, and each
  property is covered by a test rather than asserted in prose.
- Positive: **no schema change.** The plugin uses the existing `verification` table, so Phase 3's
  three migrations stand unaltered.
- Positive: the address itself is no longer recoverable from the table, since the identifier is
  hashed.
- Negative: the user experience changes from clicking a link to typing a code. For this product
  that is close to neutral and arguably better on mobile, which is the primary platform — but the
  registration screen in a later phase now needs a code field, and `UX.md` will need that step when
  those screens are designed.
- Negative: the window narrows from 24 hours to 15 minutes, so a customer who does not check mail
  promptly must request a new code. The resend endpoint exists for that and is rate-limited.
- Negative: the core `/verify-email` endpoint remains mounted, because it is part of Better Auth's
  own route set. Nothing in the application issues a token for it any more, so obtaining a valid
  one requires `BETTER_AUTH_SECRET` — which is already a total compromise. A test asserts that an
  invalid token is refused and that sign-up hands out no link.

---

# ADR-022: Reservation follows the entry status, not placement

## Status

Accepted

## Context

Two rules in `BUSINESS-RULES.md` appear to disagree about when stock is reserved, and Phase 8 had
to reconcile them before writing the placement transaction.

Section 10.4 is headed "Reservation happens at order confirmation" and then says placement fails
if any `TRACK` line exceeds availability, with the check and the increment of `reservedQuantity`
in one transaction. Read alone, that reads as "reserve at placement".

Section 8.10.3 is unambiguous in the other direction: **`AWAITING_PAYMENT` means the business has
committed nothing** — no stock reserved, no materials ordered, no production begun — and states
that this is precisely what makes the state safe to leave open while a customer walks to the bank.
Section 8.10.5 then relies on it: an unpaid deposit order is never auto-cancelled, and "since
nothing is reserved, leaving it open costs the business nothing."

`ROADMAP.md` Phase 8 lists "reserve stock" among the steps of the placement transaction, which is
the source of the ambiguity rather than a third position.

## Decision

Availability is **validated** at every placement. Reservation is **taken at placement only for an
order that enters `AWAITING_CONFIRMATION`** — that is, one with no deposit outstanding. An order
that enters `AWAITING_PAYMENT` holds nothing; its reservation is taken when an admin confirms the
payment and moves it to `CONFIRMED`.

The rule is expressed once, as `reservesStockAtPlacement(status)` in
`domain/order/state-machine`, immediately beside `entryStatus`, so the two cannot drift apart.

## Alternatives

- **Always reserve at placement.** Rejected: it contradicts 8.10.3 directly, and it is the
  behaviour that rule exists to prevent. An order awaiting a transfer that may never arrive would
  hold inventory for however long `depositWindowDays` allows, and since such orders are never
  auto-cancelled, indefinitely in practice.
- **Never reserve at placement; always wait for admin confirmation.** Rejected: a cash-on-delivery
  order for a stocked item has nothing left to confirm before the stock question is settled, and
  deferring the reservation would let two customers both be told they had bought the last one.
- **Reserve at placement and release on a timer.** Rejected as a third mechanism to keep correct,
  and it re-introduces the auto-cancellation 8.10.5 forbids by another name.

## Reason

The two sections are reconcilable once "order confirmation" in 10.4 is read as the `CONFIRMED`
transition rather than as "the customer confirming the order". Under that reading 10.4 and 8.10.3
say the same thing, and the only orders that reserve at placement are the ones for which placement
*is* the last step before the business commits.

## Consequences

- Positive: the promise in 8.10.3 is structural. There is no path by which an `AWAITING_PAYMENT`
  order holds stock, and an integration test asserts it against a tracked variant, where a
  reservation would have been possible.
- Positive: cash-on-delivery orders, which are the common case for stock items, still reserve
  immediately and cannot oversell.
- Negative: a deposit order's stock is not guaranteed between placement and admin confirmation. For
  V1 this is small — section 10.8 defaults blanks used for custom work to `MADE_TO_ORDER`, which is
  never stock-tracked — but it is the case section 10.9 describes, and the admin resolves it by
  hand.
- The `CONFIRMED` transition that takes the deferred reservation is written when the admin order
  workspace is built. Until then a deposit order's stock is validated but never held.

---

# ADR-023: Human identifiers come from a PostgreSQL sequence

## Status

Accepted. Supersedes the Phase 7 implementation of `nextRequestNumber`.

## Context

`DATABASE.md` section 1 requires `orderNumber`, `quoteNumber` and `requestNumber` to be
"short, unique, sequence-backed, shown to users". Phase 7 implemented `requestNumber` by reading
`MAX(request_number)` for the current year and adding one, because no sequence existed. Its
post-compaction audit recorded the consequence: two simultaneous submissions read the same maximum
and the second violates the unique index, losing a customer's request.

Phase 8 needed `orderNumber`, where the same failure would lose an order that had already been
paid for at the till in the customer's mind.

## Decision

Two PostgreSQL sequences, `order_number_seq` and `request_number_seq`, and two SQL functions,
`next_order_number()` and `next_request_number()`, formatting `CMD-YYYY-NNNN` and `DEM-YYYY-NNNN`.

`NNNN` is zero-padded to **at least** four digits and grows beyond them: the sequence is global
and never restarts, so the ten-thousandth number is `CMD-2027-10000`, not a wrapped `CMD-2027-1000`.
Phase 14 corrected that — the original `lpad(n, 4, '0')` truncated instead of growing, because
PostgreSQL's `lpad` shortens a string longer than the requested width, and the first collision
would have been a unique-constraint violation at the moment a customer pressed the button.
The application calls the function inside the placement transaction; it never computes a number
itself. The unique index on each column remains as the final defence.

The request-number retrofit shipped in the same migration, which also `setval`s the request
sequence past the highest number Phase 7 had already issued so the change cannot collide with a
number a customer has seen.

## Alternatives

- **A counter row with `UPDATE ... RETURNING`.** Atomic and gapless, and it allows a per-year
  restart. Rejected because it serialises every order behind one row lock: the second checkout of
  a busy minute waits for the first to commit. Gaplessness is worth nothing here, and throughput is
  worth something.
- **`MAX(...) + 1`, as Phase 7 did.** Rejected — it is the defect this ADR exists to remove.
- **A UUID or a random token.** Rejected: 8.10.1 makes the order number the **payment reference**,
  read aloud on the phone and typed into a transfer form. It has to be short and speakable.
- **A sequence per year, created on demand.** Rejected: it needs DDL at runtime, inside a
  transaction, to save four digits of prefix.

## Reason

`nextval` is non-transactional, which is exactly the property wanted. It never blocks, never
returns the same value twice, and needs no coordination between application instances. Its cost is
gaps when a transaction rolls back, and a gap in an order number is invisible to everyone except
an accountant who was promised a contiguous series and never was.

## Consequences

- Positive: concurrent placement is safe by construction. Six simultaneous orders produce six
  distinct numbers, asserted by an integration test.
- Positive: Phase 7's known limitation is closed rather than carried forward, and no request number
  already issued can be re-used.
- Negative: **numbering does not restart each year.** The sequence is global, so January follows
  December — `CMD-2027-0143` rather than `CMD-2027-0001`. The year is a readable prefix, not part
  of the uniqueness argument. Restarting it would need either the serialising counter row rejected
  above or a yearly manual `setval`, and neither is worth it.
- Negative: gaps appear wherever a placement rolls back. This is expected and is not a data
  problem; the numbers are identifiers, not a count of orders.
- `quoteNumber` still has no sequence. Phase 10 owns quotes and should add `quote_number_seq`
  alongside these two rather than inventing a third mechanism.

---

# ADR-024: A hostile SVG is refused, not sanitised

## Status

Accepted — Phase 9. Amends `SECURITY.md` section 6.

## Context

`SECURITY.md` section 6 treats SVG as code, which it is, and lists three
controls: sanitise on ingest, never render inline, serve as an attachment. The
sanitise step is described as parsing server-side, stripping `<script>`,
`<foreignObject>`, every `on*` attribute, external references, `@import` and any
DOCTYPE or entity, and storing **the sanitised form**.

Implementing it raised a question the document does not answer: what is the
sanitiser actually protecting, given the other two controls?

V1 renders an uploaded SVG **nowhere**. ADR-011 generates no raster preview for
SVG or PDF, so nothing decodes it server-side. It is never injected into the
DOM, never the `src` of an `<img>` on a page carrying session cookies, and every
download is served as `application/octet-stream` with
`Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, enforced
at the storage provider rather than by the application. The only party who ever
opens the file is the business owner, deliberately, in a design tool.

## Decision

**Detect and refuse**, rather than rewrite. `domain/design-file.inspectSvg`
returns every hostile construct it finds, and a file with any finding is marked
`REJECTED` with a reason the customer can act on, its object deleted. An SVG
that passes is stored **byte-for-byte as the customer sent it**.

The other two controls of section 6 are implemented unchanged, and are what the
security argument now rests on.

## Alternatives

- **Sanitise and store the rewritten file, as written.** Rejected on three
  grounds. It buys nothing at render time, because nothing renders. A
  hand-written XML rewriter is *more* attack surface than a detector — it must
  parse hostile input correctly and re-serialise it correctly, and a mistake in
  either direction produces a file that looks clean and is not. And it silently
  alters a customer's logo: a stripped `<style>` block can change how a design
  looks, and the customer would discover it on a finished garment.
- **A third-party sanitiser (DOMPurify with jsdom).** A serious option, and the
  right one if V1 ever renders SVG. Rejected for now as a large dependency and a
  server-side XML parser — new attack surface — bought to protect a rendering
  path that does not exist.
- **Refuse SVG entirely.** Rejected by `SECURITY.md` already, and correctly:
  logos arrive as SVG, and refusing them pushes the most valuable customer
  segment back to WhatsApp.

## Reason

Refusing is strictly safer than rewriting, and it is honest with the customer:
"this SVG contains a script, export it flat" is a sentence they can act on,
whereas a silent rewrite is a change to their artwork they never agreed to.
The detector is deliberately conservative — it works on the raw text, so an
encoding trick that hides `<script` from it also hides it from a parser that
agrees with it, and anything ambiguous is a finding rather than a pass.

## Consequences

- Positive: no XML parser and no re-serialiser runs on customer input.
- Positive: the stored file is exactly what the customer sent, so what the owner
  opens is what the customer meant.
- Positive: a rejection is explained, and the builder offers a retry.
- Negative: an SVG carrying a harmless `<style>` block with an `@import`, or an
  external `<image>` reference, is refused where a sanitiser would have accepted
  a cleaned version. Exporting flat from any design tool produces a file that
  passes; the copy says so.
- Negative: the detector is text-based, so a file that is *technically* valid
  SVG but written adversarially enough to defeat it would be stored. It would
  still never be rendered, which is why the other two controls carry the weight.
- If V1.5 adds SVG thumbnails, this decision must be revisited **before** the
  first one is rendered: at that point sanitisation stops being redundant.

---

# ADR-025: A separately priced `EMBROIDERY` line becomes a `CUSTOM` line, not a `FEE`

## Status

Accepted — Phase 10. Refines `BUSINESS-RULES.md` 2.6.5.

## Context

2.6.5 maps every quote line onto an order line. For `EMBROIDERY` it gives two
options: folded into the unit price of the `PRODUCT` line it prices, **or** "its
own `FEE` order item where the admin priced it separately".

Implementing the second option ran straight into two database constraints the
same phase specified:

- `cart_items_fee_check` requires a `FEE` line to have `quantity = 1` and a null
  `customization_config_id`;
- `order_items_fee_check` requires the same plus `requires_production = false`
  and a `fee_kind`.

An embroidery line is none of those things. It is quoted per unit — "50 pieces,
left chest, two colours" is quantity 50 — it names the configuration being
embroidered, and it certainly requires production. And `FeeKind` has no
`EMBROIDERY` member, so mapping it would have to file real embroidery under
`OTHER`.

## Decision

A separately priced `EMBROIDERY` line becomes an order item of `kind = CUSTOM`,
carrying the frozen `customizationConfigId`, exactly as `PRODUCT` does. The
`FEE` mapping in 2.6.5 stands for the four fee kinds — `SETUP_FEE`,
`DIGITIZING`, `RUSH_FEE` and `OTHER` — and for those only.

## Alternatives considered

- **Force `quantity = 1` on `EMBROIDERY` lines**, as `validateQuoteLines`
  already does for fees. Rejected: it would stop an admin quoting embroidery per
  unit, which is how embroidery is actually priced, and would make the line
  total a number nobody could check against a piece count.
- **Relax the fee constraints** to admit a multi-quantity fee carrying a
  configuration. Rejected: that constraint is what caught the Phase 8 mapping
  defect, and widening it to fit one case removes the check for all of them.

## Reason

2.6.5's own note says "the admin's line structure is preserved as authored", and
the consequences it lists are arithmetic — `orders.subtotal` is the sum of item
line totals, and `orders.grandTotal` equals the quote's. Both hold identically
under either mapping. What differs is meaning: a `CUSTOM` line keeps the link to
the configuration, keeps `requiresProduction` true, and therefore keeps the
order eligible for `DESIGN_REVIEW` (8.3). A `FEE` line would sever all three to
satisfy a table cell.

## Consequences

- Positive: the production side of an order can always find the configuration
  behind every line that has to be made.
- Positive: the fee constraints keep their full strength.
- Positive: no quantity restriction is imposed on how embroidery may be quoted.
- Negative: 2.6.5's table is now narrower than it reads, and this ADR is the
  place that says so. `BUSINESS-RULES.md` 2.6.5 carries a pointer here.
- A quote line of kind `PRODUCT` or `EMBROIDERY` that names no request item, and
  belongs to a request with no items at all, cannot be mapped — acceptance
  refuses with an explanation rather than failing on the constraint mid
  transaction.

---

# ADR-026: The two credential e-mails bypass the outbox

## Status

Accepted — Phase 8A. Refines `ARCHITECTURE.md` section 11.

## Context

Section 11 makes the outbox the way this application sends e-mail: a row
written in the same transaction as the state change it announces, delivered out
of band by a dispatcher on a five-minute timer. That is exactly right for an
order confirmation, which must survive a crash between the payment and the
inbox, and must never roll the order back if a provider is down.

Two of the eight templates are a different kind of message.
`auth.verify_email` carries an 8-digit code that lives fifteen minutes
(ADR-021); `auth.password_reset` carries a link that lives one hour. Both are
issued by Better Auth in the middle of a request the person is waiting on, and
neither announces a state change anybody else can observe.

Putting them through the outbox has two costs. The scheduler's cadence spends a
third of a verification code's lifetime before the message is even attempted,
which turns "check your e-mail" into a support call. And the outbox stores its
`payload` as JSON in a durable table, so a queued credential e-mail means a
database dump — a backup, a replica, a support export — contains live reset
links and codes for as long as the row is retained.

## Decision

`sendVerificationCode` and `sendPasswordReset` render and hand the message
straight to the transport, inside the request that produced them. No row is
written, nothing is retried, and nothing about the message is recorded beyond
what the transport itself reports. Every other template goes through the outbox
without exception.

## Alternatives considered

- **Everything through the outbox, dispatched every minute.** Rejected: it
  still stores the credential, and the storage problem is the larger of the two.
- **The outbox with the payload encrypted at rest.** Rejected: a key the
  dispatcher can read is a key a dump of the same deployment can read, and it
  adds a key-rotation problem to buy back a delay we did not want anyway.
- **The outbox with the credential re-minted at dispatch time.** Rejected: the
  code is Better Auth's to issue, and re-minting it at delivery means the code
  the person is told to expect is not the code that was issued.

## Reason

The outbox exists to make an announcement survive the failure of the thing that
announces it. A verification code has nothing to survive: if the send fails, the
person asks for another one, which is a button they already have and a fresh
code that is better than the stale one a retry would deliver.

## Consequences

- Positive: no live credential is ever written to the database, so a dump, a
  replica or a support export contains none.
- Positive: the code arrives as fast as the provider can deliver it, rather than
  as fast as the next sweep.
- Negative: a provider outage during registration is visible to the person as a
  code that never arrives. The recovery is "send another", which is the same
  recovery a retried message would have needed and is already in the interface.
- Negative: these two messages have no delivery record, so "did it send?" cannot
  be answered from the database. That is the intended trade — the alternative is
  a record of the credential itself.
- The transport's development implementation logs the subject and the recipient
  and **never the body** (`SECURITY.md` 2.1), so this decision is not undone by
  a log file.

---

# ADR-027: The homepage is rows, not a component

## Status

Accepted — Phase 13. Implements `ROADMAP.md` Phase 13 ("homepage section types
all implemented and reorderable") over `DATABASE.md` section 13.

## Context

Since Phase 5 the homepage has been a component containing its own copy: a hero
sentence, four process steps, three craft points and two calls to action, all as
literals. That was right at the time — there was no database, and inventing a
content system before there was content would have been the larger mistake.

`homepage_sections` has existed since the initial migration, with a `type`, a
`position`, an `isEnabled` and a `config` JSON column. Phase 13's roadmap entry
asks for "homepage section types all implemented and reorderable", which cannot
be satisfied by a component: reordering a literal is a deploy.

The awkward part is `config`. Each section type carries different presentational
extras — how many products to show, which eyebrow label, the four process steps —
and the column is JSON precisely because those shapes differ. JSON edited by a
person is JSON that will one day be wrong.

## Decision

The homepage renders the enabled `homepage_sections` rows in `position` order,
and the copy lives in the rows. Three rules make that safe:

1. **`domain/content` reads `config`, and never throws.** Every reader returns a
   well-formed value with defaults: a malformed `config` costs a band some of its
   content, never the page. Every `limit` that reaches a query is bounded, so a
   content edit cannot turn a band into a full-catalogue scan. Icons resolve
   through a closed allow-list rather than by name.
2. **The data is loaded once.** `domain/content` declares which data each section
   type needs; `content-service` loads the union in parallel and hands it to a
   renderer that does no I/O. A band that is switched off issues no query.
3. **A band with nothing to show renders nothing.** Not an empty grid under a
   heading — nothing. A shop with no approved reviews has no reviews band.

Facts that can be read from elsewhere in the database are read from there rather
than typed into a row: the trust band's delivery figures come from
`shipping_rates`, which is what the checkout charges.

## Alternatives considered

- **Leave the homepage as literals and call the section types "implemented" by
  virtue of the enum existing.** Rejected: the enum already existed, and an enum
  nothing reads is not an implementation.
- **A general content system — blocks, a nested tree, an editor.** Rejected as
  the CMS this project has said since `PRODUCT.md` that it is not building. Eleven
  fixed types with a flat position is the smallest thing that satisfies the
  requirement.
- **A typed column per extra instead of `config`.** Rejected: it means a
  migration per presentational tweak, and `DATABASE.md` already settled `config`
  as the one legitimate JSON column, "never queried or joined on".
- **Zod for `config`.** Rejected here, not on principle: the domain layer has no
  dependencies today, the shapes are a dozen fields, and a schema that throws
  would have to be caught at every call site anyway — the readers return defaults
  instead, which is the behaviour that matters.

## Reason

Two things the owner will want to do — change the words on the front page, and
change the order of what is on it — become an `UPDATE` rather than a deploy. The
cost is that a content row can now be wrong, and that cost is bounded by the
first rule above: the failure mode of a bad edit is a thinner band, which is
visible and fixable, rather than a broken homepage.

## Consequences

- Positive: reordering, retitling and switching off any band needs no deploy.
- Positive: the page's query count follows what is enabled, and a switched-off
  band costs nothing.
- Positive: no invented social proof survives — the reviews band is approved rows
  or nothing, and the delivery figures are the shipping rates.
- Negative: the homepage's copy is no longer in the repository, so a review of
  what the front page says means reading the database or the seed. The seed
  carries the V1 copy, which keeps it in version control as the starting point.
- Negative: **there is no admin screen for these rows yet.** Editing them is a
  database update until Phase 12's outstanding content-management half is built.
  That half is where this decision pays off; until then it is a smaller win.
- The `CATEGORY_GRID` band ships **disabled**, because its cards lead to
  `/shop/c/[category]`, which Phase 6 has not built. The band is implemented and
  tested; switching it on is an `UPDATE` the day its destination exists.

---

# ADR-028: Indexing is a deployment-wide switch, off by default

## Status

Accepted — Phase 14. `ROADMAP.md` Phase 18 is where it is turned on.

## Context

Since Phase 2 the root layout has carried `robots: { index: false, follow: false }`
with the comment "opened up at launch (Phase 18). A foundation must not be
indexed." That was right, and it stopped being enough the moment Phase 14 gave
every public page its own robots directive: two mechanisms deciding the same
thing, one of them a literal in a component.

The failure this guards against is specific and expensive. A staging copy, a
preview deployment or a developer's tunnel that quietly enters the index
competes with the real site for its own product pages, and getting a URL back
out of an index is slow and manual. The reverse failure — a launched site that
forgets to become indexable — is fixed by one deploy.

## Decision

One server variable, `SEO_INDEXABLE`, decides whether the deployment may be
indexed at all. It is **off unless explicitly set to `"true"`**.

- `lib/seo`'s `publicRobots()` returns `index, follow` when it is on and
  `noindex, nofollow` when it is off. Every public page's metadata goes through
  it, and so does the root layout's default.
- `robots.txt` disallows everything while it is off, and publishes the sitemap
  only while it is on.
- `sitemap.xml` is empty while it is off — publishing a map of a site that asks
  not to be indexed is a contradiction a crawler resolves however it prefers.

A private page's `noindex` does **not** go through the switch. `/account`,
`/admin`, the cart, the checkout and the order pages are `noindex` regardless,
because that direction must never depend on configuration.

## Alternatives considered

- **Per-route directives only, with no global switch.** Rejected: it is the
  situation Phase 14 started in, and it means a staging deployment is indexable
  the day someone gets the metadata right.
- **Derive it from `NODE_ENV === 'production'`.** Rejected for the reason
  `lib/storage` and `lib/email` were: a production build on a laptop is still a
  laptop, and a preview deployment is a production build by every measure the
  runtime can see.
- **A `seo` settings row instead of an environment variable.** Tempting —
  `DATABASE.md` section 14 already declares a `seo` settings group, and the owner
  could flip it without a deploy. Rejected for now: the root layout's metadata is
  a module-level constant, and making it read a settings row would force every
  page under it to render dynamically, trading the storefront's static rendering
  for a switch that is thrown once in the life of the site. It can move there if
  a settings screen ever needs it.
- **Default on, and turn it off in staging.** Rejected: the safe default is the
  one whose mistake is recoverable.

## Reason

Indexing is an infrastructure decision, made once, by whoever performs the
launch — the same person setting the domain, the TLS certificate and the
database URL. An environment variable is where that person already looks, and a
default of "off" means the mistake a hurried deploy makes is invisibility rather
than a staging copy outranking production.

## Consequences

- Positive: one variable is the whole difference between a hidden deployment and
  an indexed one, and both states are asserted by tests.
- Positive: preview and staging deployments are safe by default, with no
  configuration at all.
- Negative: a production deployment that forgets to set it is not indexed, and
  nothing in the application will complain. `ROADMAP.md` Phase 18 lists it, and
  the launch checklist is where it has to be caught.
- Negative: **Lighthouse cannot score SEO on a deployment that asks not to be
  indexed**, so Phase 14's "at least 95" is a launch-time measurement rather than
  one this phase could take.
- It is not an access control, and `SECURITY.md` section 10 says so where
  somebody looking for authorisation would read it.

---

# ADR-029: Stock moves through an append-only ledger, never through a field

## Status

Accepted — Phase 14.5.

## Context

Until Phase 14.5 the `stock_quantity` column only ever moved as a consequence of
something the system could explain. A reservation at order confirmation, a
decrement at shipment, a release at cancellation — every one of them has an
order behind it (`BUSINESS-RULES.md` 10.4 and 10.5), so "why is this seven?"
always had an answer somewhere in the record.

Phase 14.5 gave the workshop a screen that changes the number directly, because
the alternative was what the business actually had: a SQL client, or nothing.
The moment a human can set a count, the question "who set this to seven, when,
and why" becomes real, and it is asked on exactly the day the count is wrong.

Two shapes were available and neither was right on its own. A quantity field on
the variant form is the obvious one, and it has two faults: it races every other
write to that row — a form that posts "the new total is 12" silently discards
the shipment that went out while the page was open — and it leaves no record.
`audit_logs` already exists and could hold the record, but it is admin-only
(12.1) while stock is staff work, and its JSON metadata cannot be aggregated
into "the last ten movements on this SKU", which is what the person holding the
clipboard needs.

## Decision

Stock changes are **signed deltas written to an append-only ledger**,
`inventory_adjustments`, in the same transaction as the change itself.

- The form posts a **delta**, never a final quantity. `-3` composes with a
  concurrent shipment; `12` overwrites it.
- The arithmetic happens in the database, in one conditional statement that
  carries both invariants as its own precondition:

  ```sql
  UPDATE product_variants
     SET stock_quantity = stock_quantity + :delta
   WHERE id = :id
     AND stock_quantity + :delta >= 0
     AND stock_quantity + :delta >= reserved_quantity
  ```

  Zero rows updated means the precondition no longer holds, and the service
  re-reads to say which one.
- Every movement carries a **reason** from a closed set and an optional note,
  and records the **resulting quantity** at the time. The resulting quantity is
  denormalised on purpose: replaying deltas only reconstructs a count if nothing
  else ever touched the column, and shipments do.
- The ledger is **append-only**. There is no update path and no delete path in
  the repository. A mistaken adjustment is corrected by a compensating
  adjustment with reason `CORRECTION`, the way a ledger has always worked.
- **A variant is created at zero** and stocked through an adjustment, so the
  first units on the shelf have a row like every other movement. There is no
  quantity field anywhere on the variant form.
- **An adjustment never touches `reserved_quantity`.** Those units are promised
  to orders that exist; 10.5 releases them on shipment or cancellation, and
  nothing on the stock screen may.

## Alternatives considered

- **A quantity field on the variant form.** Rejected: it races, and it is the
  one stock change in the system with no record behind it.
- **Reuse `audit_logs`.** Rejected: admin-only readership for staff work, and a
  JSON blob cannot answer "the last ten movements on this SKU".
- **Allow negative stock, and treat it as a debt.** Rejected: a negative count
  is not a debt the business can work off, it is a number that makes every
  availability calculation downstream silently wrong. 10.6 already refuses
  backorder in V1.
- **Refuse the whole feature until an inventory system exists.** Rejected: the
  business holds stock today and had no way to record receiving any of it.

## Reason

The ledger is the smallest thing that makes a manual stock change safe. It costs
one table and one transaction, and it buys the two properties that a shared
count needs: concurrent movements compose instead of overwriting, and every
number on the screen can be traced to a person, a reason and a moment.

## Consequences

- Positive: "who changed this, and why" is answerable for every unit that has
  ever been on a shelf, by staff, on the screen where they are standing.
- Positive: two operators counting the same shelf at the same time produce two
  movements and one correct total.
- Positive: the two invariants are enforced by the row itself, so a future
  caller that forgets the domain check still cannot oversell or go negative.
- Negative: correcting a mistake takes two rows rather than an edit, which reads
  as bureaucratic until the first time somebody needs the history.
- Negative: the ledger grows without bound. It is indexed by variant and date
  and nothing reads it in aggregate; if it ever needs pruning, that is a
  retention decision to take deliberately rather than a cleanup to slip in.

---

# ADR-030: Two languages, in the URL, from one typed dictionary

## Status

Accepted — Phase 14.7.

## Context

V1 shipped in French, and `PRODUCT.md` section 9 named Arabic as the likely
second language, in V2. The owner asked for English instead, now: the shop sells
to Algerian customers who read French, and to diaspora and business customers
who do not.

Three questions had to be answered together, because answering them separately
is how a half-translated site happens.

**Where does the language live?** A cookie alone, a subdomain, or the path. A
cookie makes every page two pages at one address: a crawler indexes whichever it
was served, a customer cannot send a link in the language they were reading, and
a cache in front of the site serves one visitor's language to the next.

**Where do the words live?** Scattered in the components that show them, in JSON
files loaded at runtime, or in one typed object.

**Who reads them?** A server component knows the locale from its route
parameters. A client component — a form, a dialog, a badge — does not, and
threading a `t` prop through sixty call sites is a change that is complete on
the day it lands and incomplete the first time somebody adds a component.

## Decision

- **The language is a path prefix.** Every public URL is `/fr/…` or `/en/…`;
  `middleware.ts` redirects an unprefixed public path, honouring the
  `NEXT_LOCALE` cookie first and `Accept-Language` second. `/admin`, `/api`,
  `/dev`, `/assets` and the framework's own routes are never prefixed — the
  workshop is French-only, and an API is not a page.
- **Two root layouts, in route groups.** `(site)/[locale]/layout.tsx` sets
  `<html lang>` from the route; `(workshop)/layout.tsx` is French and unprefixed.
  There is no `app/layout.tsx`, because the two trees genuinely differ in the
  attribute that matters most on the document.
- **French is the source of truth, and the type.** `dictionaries/fr.ts` is a
  plain object; `Dictionary = typeof fr`, and `en.ts` is annotated with it. A key
  added to French and forgotten in English is a compile error, not a missing
  sentence in production. The object is deliberately **not** `as const`: literal
  types would make every French string its own type, which English could never
  satisfy.
- **Interpolation is a function in the dictionary**, not a template assembled at
  the call site, so word order is the translator's decision rather than the
  component's.
- **A client component reads the pathname.** `useDictionary()` takes the locale
  from `usePathname()`, exactly as `Link` does to prefix an href. Outside a
  locale — the admin — both fall back to French.
- **Every page canonicalises to itself and names the other** through
  `alternates.languages` (`hreflang`, including `x-default`), and the sitemap
  lists both.
- **`domain/` keeps its French label maps** for e-mail and the workshop. The
  storefront's are in `labels` in the dictionaries, and a unit test fails if a
  domain map gains a key the dictionaries cannot name.

## Alternatives considered

- **A runtime i18n library.** Rejected: what it adds over a typed object is
  plural rules, ICU messages and lazy namespace loading. Two dictionaries of a
  few kilobytes need none of it, and the type checking is worth more here than
  the features.
- **A cookie or a subdomain.** Rejected for the reasons above: a cookie makes
  one URL mean two pages; a subdomain doubles the deployment for two languages
  of the same site.
- **A `t` prop on every component.** Rejected: correct in review, wrong in
  practice the first time somebody adds a component and forgets it.
- **Translating the admin too.** Rejected: the workshop is one small team that
  works in French, and every admin string would double the translation surface
  for nobody's benefit.

## Reason

The prefix is the only place a language can live where a link carries it, a
crawler can index both, and a cache cannot confuse them. The typed dictionary is
the only arrangement where "we forgot to translate this" is a build failure.

## Consequences

- Positive: a customer can send a link in the language they were reading.
- Positive: adding a third language is a dictionary and a line in `LOCALES`.
- Positive: `Link` and `useDictionary` mean a new page is localised by default
  rather than by remembering.
- Negative: several presentation primitives — the status badges, the rating, the
  quote table — became client components to read the dictionary. They still
  render on the server; the cost is a few kilobytes of hydration.
- Negative: **most of the database is not translated.** The homepage's bands
  are, because each row carries an `en` overlay inside its existing `config`
  JSON and `localiseSection` merges it — no migration, and a band that says
  nothing in English keeps the French. Everything without such a column is not:
  product names and descriptions, gallery captions, placements, thread colours,
  and the promotional banner strip all read in French in both languages.
  Translating those is a schema change — a translations table, or a JSON column
  per locale — and it is recorded as outstanding rather than half-built.
- Negative: messages returned by server actions are French in both languages —
  they are produced where there is no request locale to read.

---

# ADR-031: The dark palette is declared with `light-dark()`, not with a second theme

## Status

Accepted — Phase 14.7.

## Context

The design system is built on semantic tokens: a component says `bg-surface` and
never a colour. Adding a dark palette meant deciding where the second value of
each token lives.

The usual arrangement is a second block — `[data-theme='dark'] { … }` — that
redeclares the tokens. It works, and it drifts: a token added to the light block
is invisible in dark until somebody notices, and the two lists sit far enough
apart in the file that nobody diffs them.

## Decision

- **Each token declares both values on one line**, with the CSS `light-dark()`
  function, in a single `:root` block:
  `--stitch-surface: light-dark(var(--color-paper-0), var(--color-ink-900));`
  A token cannot be added to one theme and forgotten in the other, because there
  is only one place to add it.
- **`color-scheme` is the switch.** `:root { color-scheme: light dark }` means a
  visitor who has never touched the control already gets their system
  preference, with no JavaScript. `data-theme` on the root element overrides it,
  and the toggle sets nothing else.
- **The choice is read from the document**, not mirrored into React state: an
  inline script stamps `data-theme` before the first paint (no flash), and
  `ThemeToggle` reads it back with `useSyncExternalStore`.
- **Contrast is a token, never an opacity.** A muted colour on a dark ground is
  its own token (`fg-on-dark-muted`); `opacity` on a text colour was what made
  the first dark pass fail AA at 3.1:1.

## Alternatives considered

- **A second `[data-theme='dark']` block.** Rejected: two lists that must agree
  and no mechanism to make them.
- **Tailwind's `dark:` variant in components.** Rejected outright: it puts the
  palette back into the components, which is exactly what the token layer exists
  to prevent — and it would need a dark variant on every colour utility in the
  application.
- **Light only, with a system-preference media query and no control.** Rejected:
  a visitor whose system is dark and who wants this site light has no recourse.

## Reason

`light-dark()` makes the two palettes one artefact. It is a 2024 CSS feature
supported by every browser the project targets, and the fallback for anything
older is the light palette, which is the one the brand is designed in.

## Consequences

- Positive: adding a token means adding one line, and it is complete.
- Positive: the system preference works with JavaScript disabled.
- Positive: the axe audit runs against the dark palette in
  `tests/e2e/i18n.spec.ts`, so a contrast regression fails the build.
- Negative: a component that hard-codes an inversion (`bg-fg text-fg-on-dark`)
  is wrong in dark mode and looks right in light. Fifteen of them existed; the
  fix was more tokens (`fg-inverted`, `fg-hover`, `hover`, `track`), and the
  rule is in `DESIGN-SYSTEM.md`.
- Negative: the workshop is not themed yet. `/admin` renders in the light
  palette on purpose — its own dark pass is still on Phase 12's outstanding
  list.

---

# ADR-032: Shop photography is public, re-encoded, and never takes the customer-upload path

## Status

Accepted — Phase 14.8.

## Context

`toPublicAssetUrl` returned `null` for the whole of V1 because there was no
public origin, and `lib/storage` knew three prefixes, all private: `quarantine/`
for an upload being verified, `designs/` for verified customer artwork, and
`previews/` for the rasters generated from it. Every one of them is read through
a short-lived signed URL after an ownership check (`SECURITY.md` section 6).

Phase 14.8 had to let the workshop upload product photographs from the admin.
Those are the opposite kind of file in every respect that matters: staff put
them there, everyone may read them, and they are marketing rather than evidence.

Two things were tempting and both are wrong.

**Reusing the design-file pipeline.** It presigns a PUT, lets the browser upload
straight to the bucket, and verifies the stored object afterwards. That order is
right for a private bucket and wrong for a public one: between the PUT and the
verification the object is already readable by anyone with the URL, and the
whole point of verifying is that the bytes might be anything.

**Storing what was uploaded.** A photograph off a phone carries an EXIF block,
and that block carries GPS coordinates. Publishing the owner's home address
alongside a picture of a tote bag is a privacy failure that nobody would notice
until it mattered.

## Decision

- **A fourth prefix, `media/`, and it is the only public one.** Same key shape
  as the others — a generated UUID and a derived extension — because the shape
  is what makes traversal inexpressible. `isPublicMediaKey` is a whitelist, and
  it is the entire authorisation model of the public route.
- **The bytes pass through the server.** The admin action receives the file,
  `prepareShopImage` decodes it, applies the EXIF orientation, **drops all
  metadata**, caps the longest edge at 2400px, flattens transparency onto white
  and re-encodes as a progressive JPEG. Nothing is written to the public prefix
  until that has succeeded. `next.config.ts` raises the server-action body limit
  to match `MAX_SHOP_IMAGE_BYTES`.
- **Three checks, in cost order**: the declared type and size (free), then the
  file's own signature (cheap — the declared type is the browser's claim), then
  the decode itself, which is the only thing that proves it is an image.
- **`domain/media` is separate from `domain/design-file`.** They look alike and
  are governed by opposite rules; one table of differences in that module is
  cheaper than the day somebody applies one file's rules to the other.
- **Serving is a seam, not a coupling.** `toPublicAssetUrl` builds
  `${NEXT_PUBLIC_PUBLIC_ASSET_URL}/${key}`. In development and on a single
  server that origin is `/assets`, and `app/assets/[...path]/route.ts` streams
  the object with a one-year immutable cache; pointed at a CDN in front of a
  public bucket, the route is simply never reached and no row changes, because
  the row holds a key rather than a URL.
- **The placeholder photography stays where it is.** `public/assets/products/…`
  is served by Next before any route is consulted, so the two coexist and no
  data migration was needed.

## Alternatives considered

- **Write into `public/`.** Rejected: it is baked at build time on most hosts
  and read-only on serverless, so the feature would work on a laptop and fail in
  production — the worst possible split.
- **Presign to the public bucket, verify afterwards.** Rejected for the window
  described above.
- **Keep the original bytes beside the re-encoded one.** Rejected: the original
  is what carries the metadata, and storing it publicly would defeat the
  stripping while storing it privately would invent a second lifecycle for a
  file nobody asks for.
- **Serve public objects through a signed URL too.** Rejected: a signature that
  everyone is entitled to is a cache-buster with extra steps, and it would make
  every product image uncacheable by a CDN.

## Reason

The public prefix is one line in the key module and a route; what it buys is
that the shop can finally show its own work. Re-encoding costs a decode per
upload — a handful a week — and buys a predictable format, a bounded size, and
the certainty that nothing personal rides along.

## Consequences

- Positive: `toPublicAssetUrl` resolves, so product cards, the gallery, the
  hero and the social cards all show real images.
- Positive: the stored object is deterministic — JPEG, ≤ 2400px, no metadata —
  whatever the camera produced.
- Positive: moving to a CDN is an environment variable.
- Negative: uploads are bounded by the server-action body limit, which is a
  framework setting rather than a domain rule. `domain/media` still holds the
  real limit; the framework's only refuses first.
- Negative: replacing a hero image leaves the previous object unreferenced.
  Deliberate for now — an object still referenced by a cached page is worse lost
  than kept — and a sweep belongs with the one that already exists for stale
  uploads.
- Negative: the local adapter writes under `STORAGE_LOCAL_ROOT`, which now
  defaults to `./.storage` rather than the system temp directory, because a
  reboot losing the owner's product photographs is not acceptable behaviour even
  in development.

---

# ADR-033: The workshop's language is a preference, not a path

## Status

Accepted — Phase 14.8. Extends ADR-030.

## Context

ADR-030 put the storefront's language in the URL — `/fr/shop`, `/en/shop` — and
left the workshop French on the grounds that it had one reader. The owner then
asked for a bilingual workshop, which reopened the question the storefront had
already answered: where does `/admin`'s language live?

The arguments that made the prefix right for the storefront do not apply here.
A public page is indexed, shared and cached: the URL has to say which language
it is, or a crawler indexes one at random and a customer cannot send a link. The
workshop is behind a session, indexed by nobody, linked from nowhere, and
bookmarked by the two people who use it.

## Decision

- **The workshop's language is the `NEXT_LOCALE` cookie** — the same one the
  storefront's switcher writes. `/admin/orders` stays `/admin/orders`.
- **The server reads it once**, in the workshop's root layout
  (`i18n/server.workshopDictionary`), and it travels two ways: into `<html lang>`,
  which is what a screen reader switches voice on, and into a `DictionaryProvider`
  that every client component below reads through `useDictionary`.
- **`useDictionary` prefers the provider and falls back to the pathname.** On
  the storefront there is no provider and the path carries the language; in the
  workshop there is no language in the path and the provider carries it. One
  hook, two sources, and neither call site knows which applies.
- **The switcher does different things in the two places.** On the storefront it
  navigates to the same page with the other prefix; in the workshop there is
  nowhere to navigate to, so it writes the cookie and calls `router.refresh()`.
- **One preference, both sides.** Switching the workshop to English switches the
  shop too, which is what a person would expect from something labelled
  "Language" and needs no explaining.

## Alternatives considered

- **`/admin/fr/…`.** Rejected: it costs every bookmark the business has, for a
  surface no crawler will ever see.
- **A per-user column.** Rejected: it is a display preference, not an identity,
  and it would need a settings screen, a migration and an admin to change it for
  somebody who cannot read the screen it is on.
- **Leaving the admin French.** Rejected — the owner asked, and the dictionary
  mechanism already existed.

## Consequences

- Positive: `/admin` keeps its addresses, and every screen reads in the
  operator's language.
- Positive: reading a cookie opts the route out of static rendering, which costs
  nothing here — every admin page was already `force-dynamic`.
- Negative: the workshop's language cannot be linked to. A colleague cannot send
  "the admin in English"; they send the address and the reader switches.
- Negative: **messages produced by server actions are French in both
  languages.** They are built where there is no request locale to read
  (`media-service`, the catalogue and content services). The screens are
  translated; a refusal message is not.

---

# ADR-034: The workshop archives; it does not delete

## Status

Accepted — Phase 14.9.

## Context

Every list in the workshop only ever grew. Requests that went nowhere, quotes
that were refused, orders from a day of testing, products created to try
something — all of them stayed in their queue for ever, and the only way to
clear one was a SQL client. The owner asked for the obvious thing: *"I can't
find a way to delete the orders or requests or whatever, and in the tables add
multiple select so I can delete a lot in one click"*, then immediately amended
it — *"maybe not delete, just archive"*.

The amendment is the decision, and it is the right one for three separate
reasons:

- **An order is a receipt.** A shop that can erase the record of money it took
  has no books. The customer's own order page would 404 on a link they were
  e-mailed, the payment history would stop reconciling, and nothing about the
  screen that did it would have warned anybody.
- **A request is a customer's words and a quote is a price somebody was
  offered.** Deleting them removes the shop's half of a conversation the other
  party still remembers.
- **`ON DELETE SET NULL` is patient.** Phase 14.6 spent a day cleaning up orders
  orphaned by deleting the users that owned them. A delete button on a list is
  that mistake with a nicer interface, available to anyone with a mouse.

## Decision

**Archiving hides a row from the workshop's screens and changes nothing else.**

- Four tables carry `archived_at TIMESTAMPTZ` — `orders`, `custom_requests`,
  `quotes` and `reviews`. It is read by the admin's own lists and by nothing
  else. The customer's order page still renders, the history is intact, the
  relations are untouched, and restoring is one click.
- **Products are the exception, and they get no new column.** A product already
  archives through `products.status`, which is customer-facing: `ARCHIVED`
  removes it from the catalogue and makes its address a 404 (11.6). A second
  flag would give a product two kinds of archived-ness and nobody could reason
  about its visibility. The catalogue's existing `Archivé` filter *is* its
  archive view.
- **A published product is refused from a checkbox.** Archiving it would take a
  live product off the shop with no more ceremony than tidying a queue, so the
  bulk action skips it and says so; unpublishing stays on the product's own
  screen, where the button says what it does. Restoring a product returns it to
  `DRAFT`, never to the shop.
- **It is a staff capability** (`mayArchiveRecords`), not an admin reserve.
  Nothing here is irreversible, and tidying a queue is what the people working
  the queues do all day.
- **One hundred rows per act** (`MAX_BULK_ARCHIVE`). The lists page at fifty, so
  that covers "select everything on two pages" and refuses a payload no sequence
  of clicks could have produced.
- **Every batch writes one audit row**, with the ids in its metadata. Archiving
  is reversible, which is exactly why the trail matters: "where did Tuesday's
  order go" has an answer that names a person and a moment.
- **The archive is a URL** — `?archived=1` — like every other filter in the
  admin, so it can be linked, bookmarked and left with the back button.

The money screens follow the lists rather than the ledger: `/admin/payments`
and the outstanding total both exclude archived orders. An order somebody
archived is one they have stopped chasing, and a total that disagreed with the
list printed beneath it would be worse than either.

## Alternatives considered

- **A delete button, with a confirmation.** Rejected, above. A confirmation
  dialog does not restore a receipt.
- **A soft delete (`deleted_at`) reusing the pattern `reviews` already has.**
  Rejected: `deleted_at` on a review means *the customer withdrew it and it must
  never be shown again*. Overloading that column with "the workshop tidied its
  queue" would make one column answer two questions with different audiences.
- **Archiving by status** — a new `ARCHIVED` value on each state machine.
  Rejected: it would corrupt every existing transition table, and the status of
  an order is a fact about the order, not about who is looking at it.
- **Hiding old rows automatically after N days.** Rejected: the workshop decides
  what it is done with. A queue that empties itself is a queue that loses things.

## Consequences

- Positive: the queues are usable again, and nothing about the shop's records
  changed.
- Positive: restoring is one click, so a mistake costs seconds. That is what
  allows the action to be a checkbox rather than a dialog.
- Positive: the four partial indexes (`WHERE archived_at IS NULL`) keep the
  index the size of the working set rather than the size of the table.
- Negative: **every new list query must remember the filter.** A query that
  forgets it shows archived rows, silently. `archiveWhere()` exists so there is
  one clause to reuse, and the payment facets go through a single wrapper for
  exactly this reason.
- Negative: an archived row is still counted by anything that queries the table
  directly rather than through a list function — reports and exports included,
  when they exist. That is deliberate, and it is the same property that keeps
  the books honest.

---

# ADR-035: A placement is a transform in texture space, not a name

## Status

Accepted — Phase 14.10. Supersedes the placement half of ADR-010's reference
model; amends `BUSINESS-RULES.md` 2.3 conditions 2 and 3.

## Context

Until now the builder asked two questions about where the embroidery goes: pick
a **placement** from a list ("Poitrine gauche", "Dos"), and pick a **size** from
three presets. The customer chose two words and hoped; the workshop read two
words and guessed. Nobody involved could see the result before it was stitched.

The owner asked for the obvious thing: *"I want to place it exactly where I
want — upload the image and put it on top of the hoodie, tote bag or whatever,
hover with it so it's exactly where I want, and I'm responsible for the size
from there."* And, for caps and beanies, a view you can rotate through 360°.

Three designs were on the table for how free positioning relates to the existing
named placements. The owner chose **pure freeform** — no named zones at all —
and **the box on the photo is the size**, calibrated once per garment by the
workshop.

## Decision

**A placement is four numbers and a face, expressed as percentages of the
surface the design sits on.**

```
xPercent        the design's CENTRE, 0–100 across the surface
yPercent        the design's CENTRE, 0–100 down the surface
widthPercent    the design's width, 0–100 of the surface's width
rotationDeg     clockwise, −180…180
designSurface   FRONT | BACK | LEFT | RIGHT | TOP | WRAP
```

Five things follow from that, and each of them is the reason for the shape:

- **Percentages, never pixels.** The same four numbers position the design over
  a photograph *and* composite it into a 3D model's UV texture. A blank that has
  only a photograph today and gains a `.glb` tomorrow keeps every configuration
  ever saved against it, because nothing was stored in that photograph's pixels.
  One placement model, two renderers, no migration.
- **The centre, not a corner.** The centre is the point rotation turns about and
  the point a resize keeps still. Storing a corner would make both operations
  move the design for a reason nobody asked for.
- **No stored height.** The design's height follows from the artwork's own pixel
  dimensions, which `design_files` already records. A stored height is a second
  source of truth that can disagree with the picture the customer approved.
- **Millimetres come from one measurement the workshop takes.**
  `product_images.surface_width_mm` is how wide the garment really is across the
  full width of that picture. Everything real is derived from it, which is why
  **an unmeasured photograph can be looked at but not ordered from** — and why
  the browser sends percentages and never millimetres. A millimetre figure from
  a client is a price the client chose, because the size band is what the
  embroidery costs.
- **The named placements become nothing, and the size presets become the price
  table.** `profile_placements.priceModifier` priced *which zone* was picked and
  there are no zones any more, so the modifier is zero — explicitly, still in
  2.2's formula, rather than quietly dropped. `embroidery_sizes` stops being an
  input and becomes the **band lookup**: the customer drags a continuous size and
  the cheapest band that covers it prices it, which is how a workshop actually
  charges. Nobody quotes per square millimetre.

### What this does to the fixed-versus-quote decision

2.3's conditions 2 and 3 asked "a placement from the profile?" and "a predefined
size?". Both questions stopped existing, so both were rewritten to the question
they were really asking underneath:

| | before | after |
| --- | --- | --- |
| 2 | a placement from the profile | **placed on a measured face** |
| 3 | a predefined size | **the dragged size falls in a priced band** |

A blank with no measured photograph is not an error and not a blocked customer:
the placement step passes, the editor says to describe it in the instructions
instead, and the configuration goes to a human quote. An unfinished catalogue
should look like a shop that has to check, not a website that is broken.

A design larger than every band is the same story: a real order that a price
table cannot price.

### The step order changed

`product → design → placement → options → review`. Design now comes **before**
placement, which is the reverse of the original flow and is forced by the
feature: you cannot drag a logo onto a hoodie before you have the logo. The old
flow asked for a placement *name*, which needed nothing.

### What the customer sees when there is nothing to draw

SVG and PDF are never rendered in a browser here (ADR-011, ADR-024), and a
text-only order has no artwork at all. In both cases the editor shows a labelled
box that is still positioned, still measured and still submitted. The customer is
placing a **region**, and the workshop is told exactly which one. Pretending to
render the file would be worse than admitting we cannot.

## Alternatives considered

- **Named placements as presets the customer can nudge**, using the
  `product_image_placement_anchors` table that has sat unused in the schema
  since Phase 2. Rejected by the owner in favour of pure freeform. The table
  stays; it is the natural home for "snap to the usual chest position" if that
  is ever wanted back.
- **Keeping the size presets as the input**, with the box only indicating
  position. Rejected: what the customer saw would not have been what they got,
  which is the whole defect being fixed.
- **Storing millimetres directly.** Rejected twice over: it puts a price in the
  client's hands, and it breaks the moment the same configuration is rendered
  against a 3D model whose texture has different proportions.

## Consequences

- Positive: the customer approves a picture, and the workshop receives
  `Devant · 85 × 43 mm at (34.0%, 22.0%)`. Neither is guessing.
- Positive: the transform is renderer-independent, so the 3D viewer is additive
  rather than a second data model.
- Positive: `customization_configs` gained a `design_surface_label` snapshot, so
  a quote sent six months ago still reads correctly after the blank's photograph
  has been replaced or re-measured (ADR-016).
- Negative: **every blank needs a measured photograph before it can be
  configured properly.** That is real work for the owner — one number per
  picture — and until it is done, every request on that product is a quote.
- Negative: `placements`, `profile_placements` and `customization_configs.
  placement_id` are now legacy. They are kept, unwritten, so configurations that
  predate this phase still read correctly. Writing a guess into `placement_id`
  would make an old configuration and a new one indistinguishable.
- Negative: a design's height is unknown for SVG and PDF, so those requests
  carry a width and a note rather than two dimensions.

---

# ADR-036: A published 3D model may not reach outside itself

## Status

Accepted — Phase 14.10. Extends ADR-032's public-storage rule.

## Context

ADR-032 established the one public storage prefix, `media/`, and the rule that
makes it safe: **nothing is written there until the bytes have been decoded and
re-encoded**. A photograph on the shelf is ours, not the camera's.

A `.glb` cannot follow that rule. There is no `sharp` for geometry, re-encoding a
mesh is lossy, and the file is the modeller's work rather than a snapshot of a
tote bag. But a glTF model is not inert the way an image is: it is *a document
that points at things*. It can name external images and buffers by URI, and a
viewer will fetch every one of them from whatever host is written there.

Publishing an unexamined `.glb` means publishing a page that makes requests
somebody else chose, from every customer's browser.

## Decision

- **A second public prefix, `models/`**, separate from `media/`. Two prefixes
  rather than one `public/`, because what makes each safe is different and a
  shared prefix would let one file be written under the other's rules.
- **The bytes are kept exactly, and the file is parsed before any of them are
  stored.** `lib/model3d/glb` reads the container far enough to answer two
  questions: is this really glTF 2.0 binary, and does it reach outside itself.
- **A model that names any resource other than a `data:` URI is refused.** There
  is no safe subset worth allowing — a same-origin reference is still a
  reference to a file we do not have.
- **Parsed before written, not after.** `models/` is public: an object there is
  readable the moment it exists, so "verify afterwards" would mean serving a
  model that fetches from somebody else's server for as long as the check takes.
  This is the opposite order to customer design files, which go straight to a
  *private* bucket and are verified there (`SECURITY.md` section 6), and the
  difference is exactly the public/private one.
- **Binary glTF only.** The `.gltf` JSON flavour is a manifest referencing `.bin`
  buffers and texture images beside it; accepting it would mean accepting a
  folder and serving a document whose dependencies are paths.
- **The printable material is chosen by a person.** A garment model names its
  surfaces — `Fabric`, `Rib`, `Zipper`, `Label` — and exactly one is the thing
  you embroider. Nothing can guess it reliably, so the parser lists them, the
  admin picks, and the pick is verified against the file when it is stored.
- Other refusals, all with a sentence saying what to do next: a size ceiling of
  24 MB, a declared length that must equal the actual length, a JSON chunk that
  must come first, and a document that must contain at least one mesh and one
  material.

## Alternatives considered

- **Stripping the external references and re-serialising.** Rejected: it means
  writing a glTF *writer*, and a model silently missing its textures is a
  support conversation rather than a refusal the owner can act on.
- **Serving models from a separate origin.** A real mitigation for a real risk,
  and worth revisiting at scale. It does not remove the need to parse: the
  request still leaves the customer's browser.
- **Trusting the modeller.** The owner commissions these from outside the
  business, which is precisely the case the rule is for.

## Consequences

- Positive: a published model is self-contained by construction, and the
  guarantee is tested against hand-built containers rather than asserted.
- Positive: the public asset route has one whitelist that grants access and
  states the content type together, so a third public prefix cannot be added
  without deciding both.
- Negative: a modeller who exports with external textures gets a refusal. The
  message names the export setting to change.
- Negative: the parser is shallow by design. It does not validate geometry, so a
  model that is valid and wrong renders as nothing — the modeller's problem, and
  visible immediately.

---

# ADR-037: The settings screen writes a catalogue, not the table

## Status

Accepted — Phase 14.12.

## Context

The `settings` table has existed since Phase 2 and has been read since the first
day: every rate in the custom-embroidery price, the quote threshold, the deposit
percentage, the response time the front page promises. What never existed was a
screen. Changing any of them meant a SQL client, and the omission had already
cost this project twice — `notifications.adminRecipients` sat empty, which
silently dropped every "new order" e-mail to the workshop, and `brand.name` was
seeded and then read from a TypeScript constant rather than from the row.

The obvious implementation is a form over the table: list every row, render its
value, save what comes back. It is also wrong twice over. Some rows are not
preferences — `custom_orders.maxThreadColors` is a safety limit that the pricing
code assumes is sane — and a form that posts a key is a form that can post *any*
key. And a value that is merely stored is not a value that is safe: a deposit of
150 % produces an order that can never be paid, and a response time of zero
hours is a promise the shop breaks by existing.

## Decision

- **A hand-written catalogue in `domain/settings`, not a query.**
  `EDITABLE_SETTINGS` names the twelve settings the screen offers, in the order
  it renders them, with each one's kind, group and bounds. Appearing on the list
  is what makes a setting editable; a key that is not on it is refused as
  `UNKNOWN_KEY` rather than ignored, so a tampered payload cannot look like a
  successful save.
- **The bounds live in the domain and are enforced twice.** The screen validates
  so the owner sees every bad field at once, and the service validates the same
  rules again over whatever the browser actually sent. Neither invents a rule of
  its own.
- **Only the differences are written**, in one transaction, stamped with the
  actor. "Who changed the deposit percentage, and when" is the question the
  table's `updated_by_user_id` exists to answer, and writing all twelve rows on
  every save would erase the answer.
- **Admin only** (`mayManageSettings`), and the guard is in the action as well as
  the layout: a member of staff can reach the URL and cannot write through it.
- **Nothing is disabled while it is invalid.** The save button stays live and the
  refusals appear against the fields. A greyed-out button with no explanation is
  the most common way a form wastes somebody's afternoon.

## Alternatives considered

- **A row-driven form over the whole table.** Rejected above: it publishes
  internal limits as preferences and accepts arbitrary keys.
- **A save per field.** Rejected: a deposit percentage and a quote validity are
  two halves of one commercial decision, and committing each keystroke makes a
  half-changed policy reachable.
- **Storing types and bounds in the table.** Tempting, since `settings.type`
  already exists. Rejected because the bounds are business rules and belong where
  the rest of them are — unit-testable without a database, and visible in the
  same file as the reason each one exists.

## Consequences

- Positive: adding a setting to the screen is one entry in one list, and the
  screen, the validation and the tests all follow from it.
- Positive: the two settings that caused real incidents are now editable, and
  `brand.name` is read from the row it was always seeded into.
- Negative: the catalogue has to be kept in step with the seed. A setting named
  there but absent from the database is skipped rather than invented, and the
  screen says to run the seed.

---

# ADR-038: Closing the shop is a layout, and sign-in sits outside it

## Status

Accepted — Phase 14.12. Amends rule 9C in `CLAUDE.md`.

## Context

`site.storefrontEnabled` is the owner's kill switch: off, the public site stops
taking orders while the workshop carries on. Three things made it harder than a
boolean.

**The storefront is cached.** The front page, the catalogue and the builder were
all prerendered and revalidated every five minutes (`revalidate = 300`), which is
most of what makes the shop fast. (Phase 14.13 has since made the catalogue
dynamic — it reads `searchParams` — which changes none of the reasoning below;
the front page and the builder are still cached, and were the pages that
returned 500.) A switch that only changes a database row
changes nothing a visitor sees for up to five minutes, and "one more customer got
in" is not an acceptable rounding error on a switch whose whole purpose is to
stop them.

**Staff are tempting to exempt.** The first implementation let signed-in staff
through to the real site with a banner, so an owner could still look at their own
shop. It could not work, and the way it failed is worth recording: recognising
staff means reading a cookie, reading a cookie makes a render request-specific,
and Next refuses that inside a route it has been told to prerender. The three
cached pages returned **500** the moment the shop closed — not a stale page, an
error page.

**And a switch can lock you out.** `/admin` sends a signed-out visitor to
`/login`. If the curtain covers sign-in, an owner who closes the shop and then
loses their session has shut themselves out of their own business with no way
back in.

## Decision

- **The gate is the `(storefront)` layout**, not the root one. Everything
  commercial hangs off it — catalogue, builder, cart, checkout, customer account
  — so the question is asked once, and the answer is a page with no navigation,
  no footer and nothing to click.
- **`/login` lives in a sibling group, `(entrance)`**, which has no gate. A route
  group changes no URL, and both groups render the same shell, so the seam is
  invisible. Sign-in is how the workshop reaches `/admin`; it is not part of the
  shop.
- **No staff exception.** Closed means closed, for the owner too. Reopening is
  one click and takes effect on the next request, which is a better answer than a
  preview that costs the catalogue's cache.
- **The switch is published by invalidating the cache, and the invalidation names
  the route group**: `revalidatePath('/(site)/[locale]', 'layout')`. That is the
  tag every storefront page is actually stored under. The first request after a
  save is a cache miss and renders the curtain.
- **The settings read itself is memoised per request only** (`cache()` from
  React), never across requests. The pages where a repeated query would cost
  anything are the cached ones, where it runs once per regeneration regardless.

## Alternatives considered

- **A short time-to-live on the settings read.** The first attempt. It made the
  query cheap and did nothing about the cached *pages*, which is where the
  staleness actually was.
- **A cache tag on the settings read.** The second attempt, and worse: the entry
  then lived until something invalidated it, so any change that did not go
  through the screen — the seed, a migration, a hand-written `UPDATE` — never
  arrived at all.
- **`revalidatePath('/fr', 'layout')`.** Looks like the concrete-path form rule
  9C asks for. It produces a tag nothing has ever been stored under and fails
  silently, which is the hazard rule 9C is about. See the rule's amended wording.
- **Dropping `revalidate` from the storefront and rendering every page per
  request.** It would have made the staff exception possible. Rejected: it trades
  the catalogue's speed for a preview, and re-opens every page to a per-request
  database round trip for data that changes weekly.
- **Gating in middleware.** The architecturally tidy place for a gate, and it
  would keep both the cache and the staff exception. Rejected for now: it needs a
  database read on the request path plus a session lookup to recognise staff,
  which is a large amount of machinery for one boolean.

## Consequences

- Positive: the switch takes effect on the very next request, with the
  catalogue's cache intact.
- Positive: sign-in cannot be closed by accident, so the owner cannot lock
  themselves out.
- Negative: an owner cannot preview their own closed shop. The field's help text
  says so.
- Negative: one more route group, and a shell shared by two layouts.

---

# ADR-039: A narrowed catalogue is a URL, and only one of them is indexed

## Status

Accepted — Phase 14.13.

## Context

`/shop` was one grid of everything, with no search, no order and no pages. That
is fine at eight products and unusable at forty, and the owner is about to add
forty. `UX.md` section 2 has always listed the catalogue as "search, filter,
sort, paginate" and section 4 asks for category chips, a default order and a
visible filter count; none of it existed, because a filter that filters nothing
is worse than no filter at all.

Three questions had to be answered before any of it could be built.

**Where does the state live?** A filter panel with React state is the obvious
implementation and the wrong one for this shop. `/shop` is a page a customer
sends to somebody — "here, these are the ones I meant" — over WhatsApp, which is
how this business is actually conducted. State that cannot be pasted into a
message is state that loses the conversation.

**What is a category?** The schema has had `categories` since Phase 2 and every
product points at one, but a category could be a filter (`/shop?category=polos`)
or a page (`/shop/c/polos`). Both work; they differ in what a crawler and a
customer can hold on to.

**What gets indexed?** Search, order, page and two switches multiply into
hundreds of addresses for eight products. Left alone, that is a crawler
indexing `?sort=PRICE_DESC&page=3` and a customer landing on it.

## Decision

- **Every narrowing is in the URL**, parsed by `domain/catalogue/browse` and
  never held in component state. The search box, the order and the switches are
  one `GET` form with one submit button; the categories are links. Nothing on
  the catalogue needs JavaScript to work.
- **A category is a page**, at `/shop/c/<slug>`, with its own heading, its own
  description, its own canonical and its own sitemap entry. The `c` segment
  exists because two dynamic segments cannot share `/shop/*` — Next could not
  tell `/shop/polos` the product from `/shop/polos` the category — and putting
  it on the category keeps the *product* at the shorter address, which is the
  one customers are given.
- **One listing is indexed.** `/shop` and each `/shop/c/<slug>` are indexable;
  every view of them — a search, an order, a page — is `noindex, follow` and
  canonicalises to the listing it narrows. `follow` matters: a crawler is
  welcome to walk page three to reach the products on it.
- **The page number counts as a view.** Arguable, and argued in
  `isDefaultCatalogueView`: the modern general advice is a self-canonical on
  page 2, and it is right for a catalogue of two thousand. This one holds eight,
  every product on page 2 is one hop from page 1, and one indexable catalogue is
  worth more than four near-identical ones.
- **Filtering happens in PostgreSQL, including availability.** "In stock" is
  derived from a policy and two counts and could be computed in JavaScript;
  doing so would mean fetching the catalogue to show twelve of it and paginating
  over a total that disagrees with what the visitor can see. The comparison is a
  column reference (`prisma.productVariant.fields.reservedQuantity`), so it runs
  row by row in the database.
- **`/shop` is therefore no longer ISR.** A page whose content depends on its
  address cannot be one cached copy. It costs three indexed reads per request —
  the page, its total, and the unfiltered total — and the front page and the
  builder keep their five-minute cache.
- **A category with live products may not be hidden.** The products would keep
  their pages and keep selling while the shelf they sit on vanished. The rule is
  `mayDeactivateCategory`, enforced in the service against a live count rather
  than against a number the form remembered.

## Alternatives considered

- **A client-side filter panel.** Instant, and produces no address. Rejected on
  the WhatsApp argument above; also every filtered view would be invisible to a
  crawler.
- **`?category=` instead of `/shop/c/`.** One less route, and a category would
  never be indexable — which for a shop whose categories are "polos" and
  "casquettes" throws away the search terms customers actually use.
- **Debounced live search.** Nicer on a fast connection, and it needs
  JavaScript, a loading state, a race-condition policy and a history strategy.
  A form with a button needs none of them and is not meaningfully slower on the
  connections this shop's customers have.
- **Sorting by the resolved unit price.** Correct in a way the current sort is
  not: a variant may override the price, so `basePrice` is an approximation.
  Rejected because resolving it means computing a price for every row in the
  catalogue before taking twelve. Written down in `catalogueOrderBy` rather than
  hidden.
- **Accent-insensitive search.** "brode" does not find "brodé", which is a real
  limitation in French. Fixing it properly means the `unaccent` extension and an
  expression index — a migration for a catalogue of eight products. Recorded in
  `catalogueWhere` so the next person knows it is a known limit.

## Consequences

- Positive: a filtered catalogue is an address that survives being shared,
  bookmarked and reloaded, and works with scripts off.
- Positive: categories became manageable from the workshop in the same change,
  because a category page with no screen behind it is a page nobody can create.
- Negative: `/shop` costs three queries per request where it used to cost none.
  Measured against a page that already rendered a grid of photographs, this is
  not the expensive part.
- Negative: applying a filter takes a button press rather than a click. The
  categories, which are the most-used filter, are still one click.

---

# ADR-040: The catalogue is translated by an overlay, with French as the fallback

## Status

Accepted — Phase 14.14. Extends ADR-027's `config` overlay from the homepage to
the catalogue.

## Context

The interface has been bilingual since Phase 14.7: two typed dictionaries, a
language in every URL, a workshop that follows a cookie. The **catalogue** never
was. Product names, subtitles, descriptions, category names, gallery captions
and the banner strip are rows in tables with one column per field, so an English
visitor read an English shell wrapped around French content — the largest
remaining gap between what the site claims to be and what it is.

ADR-027 had already answered a smaller version of this question. The homepage is
data, and its bands carry their translations inside their own `config` column,
keyed by locale, merged by `localiseSection` with French as the fallback. That
mechanism's own comment said what it did not cover: *"It does not translate the
catalogue: product names, descriptions and gallery captions are their own rows,
and giving them a language is a schema change."*

This is that schema change, and the question was whether to repeat the overlay
or to introduce the thing a textbook would reach for — a `product_translations`
table, keyed by `(product_id, locale)`.

## Decision

- **A nullable `translations` JSONB column** on `products`, `categories`,
  `gallery_items` and `banners`, keyed by locale and then by the column it
  overrides: `{"en": {"name": "Embroidered cap"}}`.
- **French is the source of truth and lives in the row's own columns.** No `fr`
  key is ever written. Every query that does not care about language — the
  admin, the sitemap, an order snapshot — keeps working untouched.
- **The fallback is per field, not per row.** A product with an English name and
  no English description reads correctly: the overlay supplies what it has and
  the rest stays French. A half-translated catalogue is the normal state of one
  that is being translated, and it has to render properly rather than merely not
  crash.
- **Blank is not a translation.** An overlay field that is empty or whitespace
  is treated as absent on read *and* removed on write, so clearing a box in the
  form gives the French back. There is no way to say "translate this to
  nothing", and none is wanted.
- **The caller names the translatable fields** (`localise(row, overlay, locale,
  ['name'])`). The overlay is a JSON column an admin form writes; merging
  whatever it contained would make it a way to set a price.
- **The overlay is applied at the repository boundary**, where a row becomes a
  DTO, not in each page. A page cannot forget to translate, because the only
  `name` it can reach is already the right one.
- **Search follows the reader.** Browsing in English also matches the English
  name, as a JSON path match, while still matching the French columns — a
  half-translated catalogue must not be half-unsearchable.
- **A check constraint** on each column: the overlay is an object or nothing.
  The column is written by a form, and a malformed overlay would fail silently
  by simply not translating anything.

## Alternatives considered

- **A `product_translations` table.** The textbook answer, and better on three
  counts: `ORDER BY name` could sort in the reader's language, translated search
  could use an index, and a third language would be rows rather than a wider
  object. Rejected for now because it is four tables and four sets of repository
  plumbing for two languages, because partial translation is the awkward case in
  a table and the natural one in an overlay, and because the project already
  made this call once for the homepage — two mechanisms for one problem is worse
  than one imperfect mechanism. **The migration is mechanical when it is
  needed**: the overlay's shape is exactly one row per locale.
- **Translating at render time from a dictionary.** Only works for copy the
  developers write, which is exactly what the dictionaries already do. Product
  names belong to the business, not to the build.
- **Machine translation on the fly.** A network call on the catalogue's hot
  path, a cost per render, and a shop whose product descriptions are written by
  a machine that has never seen the garment.
- **Writing French into the overlay too**, for symmetry. Rejected: two places
  for one value and no rule about which wins.

## Consequences

- Positive: an English visitor reads an English catalogue, and the owner
  translates it from the same form they price it on — the French text is printed
  beside each box so a translator can see what they are matching.
- Positive: nothing that does not ask for a language changed behaviour. The
  default is French, so every existing caller kept working.
- Negative: sorting by name sorts by the French name in both languages.
- Negative: translated search is a JSON path match, not an indexed column. Fine
  over hundreds of rows; the trigger for revisiting it is written in the
  migration.
- Negative: a third language widens an object rather than adding rows. Also
  written down there.

---

# ADR-041: A nonce-based CSP, and the caching it costs

## Status

Accepted — Phase 15. Amends ADR-038's account of what is cached.

## Context

`SECURITY.md` section 12 has specified a Content-Security-Policy since Phase 0,
"delivered as a header, with nonces for the framework's inline scripts". What
shipped instead was four directives in `next.config.ts` — `frame-ancestors`,
`base-uri`, `object-src`, `form-action` — chosen because they cannot break
anything, with a comment saying the real policy "requires middleware and is
deliberately deferred to Phase 15". This is Phase 15.

The difficulty is not writing the policy. It is that **a strict `script-src`
and a cached page are mutually exclusive in the Next.js App Router**, and the
reason is structural rather than incidental:

- Next streams its hydration payload through **inline `<script>` elements**.
  They are not optional and their content differs per page.
- An inline script is allowed by a CSP in exactly three ways: `'unsafe-inline'`,
  a hash, or a nonce. The first allows every injected script as well, which is
  the attack the policy exists to stop. The second cannot work for content that
  differs per render.
- That leaves a nonce — a value that must differ per request, or it is not a
  nonce. Reading it in a layout means reading a request header, which opts the
  route into dynamic rendering.

So the policy the security document asks for costs the prerendering of every
page under the layout that renders the nonce — which by this point was `/` and
`/custom`, the catalogue having become dynamic in Phase 14.13.

## Decision

- **A per-request nonce, minted in the middleware**, which is the only place
  that runs before a response is built. It travels two ways: down to the browser
  in the policy header, and back in on the request headers, where
  `lib/security/nonce` reads it.
- **`script-src 'self' 'nonce-…' 'strict-dynamic'`**, with no `'unsafe-inline'`.
  `'strict-dynamic'` lets a nonced script load the chunks it needs without every
  chunk URL being listed, which is what makes the policy survive a code-split
  application.
- **`style-src` keeps `'unsafe-inline'`.** Next's font loader and React's own
  inline styles need it, there is no nonce path for `style` attributes short of
  rewriting every one in the application, and an injected stylesheet is a
  defacement risk rather than an execution one.
- **`'unsafe-eval'` in development only**, because the dev server compiles
  modules in the browser and production never does.
- **The prerendering is given up**, deliberately. A strict CSP is a permanent
  property of every page; ISR on two pages of a small shop is a few milliseconds
  on a site whose catalogue already renders per request.
- **The JSON-LD block carries the nonce too.** It is a data block and is never
  executed, browsers differ on whether `script-src` governs it, and the failure
  is silent — a blocked block does not break the page, it stops the shop
  appearing as a rich result.
- **One CSP, from one place.** The static policy was removed from
  `next.config.ts` rather than left beside the new one: a browser intersects two
  CSP headers, so a leftover would silently narrow the real policy.

## Alternatives considered

- **Hashes instead of a nonce.** Would keep the prerendering. Works for the
  theme script, whose content is fixed, and cannot work for Next's hydration
  payload, whose content is the page. Rejected because it solves the easy half.
- **`'unsafe-inline'` with a nonce as well.** A browser that understands the
  nonce ignores `'unsafe-inline'`, so this is the documented way to keep old
  browsers working. Rejected: the browsers it helps are the ones least able to
  defend themselves, and every browser this shop's customers use supports
  nonces.
- **Report-only first.** The standard careful rollout, and right for a site with
  traffic to learn from. This one has no traffic yet, and the whole policy was
  verified against every page in a browser before it shipped.
- **Keeping the policy in `next.config.ts` and skipping nonces.** What was
  already there. It leaves `script-src` unset, which means `default-src 'self'`
  governs scripts and Next's own inline hydration is blocked — so in practice it
  meant no `script-src` at all.

## Consequences

- Positive: an injected `<script>` does not execute, which is the single most
  valuable thing a CSP does.
- Positive: the storefront now renders per request everywhere, so the class of
  bug where a cached page disagrees with the database — which cost three
  debugging sessions across Phases 14.8, 14.12 and 14.13 — is gone rather than
  narrowed.
- Positive: ADR-038's staff-preview exception becomes possible again, because
  nothing under the storefront layout is prerendered any more. It is **not**
  reinstated here; that is a product decision, not a side effect.
- Negative: every storefront page costs a render. Measured against a page that
  already queries a database and serves photographs, this is not the expensive
  part — but it is a real change and it is why this is an ADR.
- Negative: `style-src 'unsafe-inline'` remains. Closing it means a design-system
  change, and is the obvious next step if this is ever tightened further.

---

# ADR-042: The storefront is rounded; the workshop is not

## Status

Accepted — Phase 16. Amends `DESIGN-SYSTEM.md` sections 1 and 7.

## Context

The owner commissioned a redesign and supplied four references: a cafe site for
the structure (`sons.visionwebdevs.tech`), an embroidery designer for the
placement editor (`stickerei.com`), an order form for the idea of previewing
artwork as stitching (`embroideryli.com`), and the business's own Instagram and
TikTok — 3.5K and 21.5K followers under the words "LUXURY EMBROIDERY" — for the
palette and the voice. The instruction, in one line, was **sons' structure,
Bizeora's skin**.

Most of that is work rather than a decision. One part is a decision, because it
contradicts something already written down.

`DESIGN-SYSTEM.md` section 7 says radii are "deliberately tight" because "large
radii read as a consumer app", and section 1 lists "no rounded blue buttons"
among the things the product must not read as. The reference layout is built
almost entirely out of **large rounded photographic cards and pill-shaped
controls**. Taken literally, the existing rule forbids the redesign.

It is not, however, the same rule applied to the same thing. Two different
surfaces are involved and they have opposite requirements:

- The **storefront** sells garments. Its job is photography, and a photograph in
  a generously rounded frame reads as a printed card laid on the page; the same
  photograph at 6px reads as a `<div>` with a picture in it. This is the single
  borrowed gesture the whole new layout rests on.
- The **workshop** is an instrument somebody uses for six hours a day. A dense
  table of orders with soft corners on every control reads as a toy, and section
  12's "same brand at working speed" is the reason it exists at all.

## Decision

**Radius splits by surface, and the split is expressed in the token file rather
than in components.**

- Controls keep the existing tight ramp — `sm` 1px, `md` 3px, `lg` 6px. The
  workshop uses these and is visually unchanged by this ADR.
- Two new steps, `xl` (14px) and `2xl` (28px), exist **for photographic frames
  and floating surfaces only**: image cards, the header's pill bar, the footer's
  top corners, full-bleed section bands.
- `Button` gains a `shape` variant — `tight` (the default, so nothing moved) and
  `pill`. The storefront passes `pill`; the workshop does not.

The accompanying skin changes are not separate decisions and are recorded here
for the record rather than argued: the accent ramp is re-dyed from madder
(`#8a3623`) to brass (`#b8924a`, with `#8c6d33` as the text-safe step), the
neutrals warm about a point towards marble, `display-3xl` is added for the one
hero on a page, and `Fraunces` is loaded with its `opsz`, `SOFT` and `WONK` axes
plus a real italic so that one word in a headline can be set as lettering.

## Alternatives considered

- **Refuse the reference and keep the restraint.** Defensible — the written
  direction is good and was arrived at deliberately. Rejected because the
  owner's own audience, on the owner's own channels, is a streetwear audience,
  and the reference was supplied with the business's social accounts attached to
  it. "Tight radii" was a means to "premium", not the goal.
- **Change `--radius-lg` to 28px and let it apply everywhere.** One line. It
  would have rounded every table cell, input, badge and menu in the admin, which
  is the exact failure section 12 was written to prevent.
- **Round everything on the storefront, controls included, via a second token
  file loaded per route group.** Two sources of truth for one scale; the first
  component shared between the two trees — and there are many — would have to
  choose one, silently.
- **Take the reference's colour as well.** The reference is orange-red on cream.
  Rejected explicitly by the owner: brass is what the workshop's own photography
  is full of, and the hot orange belongs to somebody else's brand.

## Consequences

- Positive: the storefront can be rebuilt from the reference's vocabulary
  without a component ever writing a raw radius, because both ends of the scale
  are named.
- Positive: the workshop is untouched. `shape` defaults to `tight`, so this ADR
  changed no admin screen.
- Negative: there are now two correct answers to "how round is this", and the
  answer depends on which half of the product the component is in. A component
  shared by both — `Button` is the live example — has to be told. That is the
  cost, and it is why the default is the conservative one.
- Negative: `DESIGN-SYSTEM.md` section 1's "must not read as" list is now
  slightly weaker than it was. The clause that mattered — *colour restraint,
  near-black primaries, typography carrying the hierarchy* — is unchanged, and
  that is the clause the redesign keeps.

---

# ADR-043: The embroidery preview is a rendering, never a file

## Status

Accepted — Phase 16.

## Context

The owner asked for the thing one of the reference sites does: the artwork a
customer uploads should be shown **as embroidery** before they order it.

The reason this is worth building is not decoration. A flat PNG of a logo
answers almost none of the questions somebody has before paying to have it
stitched. Thread has a small palette, a direction and a strong sheen; a
gradient becomes six bands of colour, a photograph becomes mud, and hairline
detail disappears. `designAdvice` has said so in words since Phase 7 — "sharp
images with clear outlines and few colours embroider best" — and words are a
much weaker instrument than a picture of the customer's own logo.

The question an ADR has to answer is **where the effect lives in the system**,
because the obvious answer is wrong in a way that is expensive to undo.

## Decision

**The stitched image is produced in the customer's browser, from a copy, and is
never stored, never uploaded, and never shown to the workshop.**

- `domain/embroidery` holds the model as pure functions — palette reduction,
  thread geometry, the shadow in the valley and the light off the crown. No
  I/O, no canvas, unit tested.
- `lib/embroidery/render` is the canvas work: scale, read the pixels, run the
  loop, hand back a data URL. The same split as `domain/media` and
  `lib/media/shop-image`.
- `components/commerce/StitchPreview` renders the original immediately and
  swaps the render in when it is ready. Every failure path returns the original
  picture.
- The builder owns the stitched/original choice as view state, so the design
  step and the placement editor always agree, and it is **not** part of
  `BuilderState` — it is not a property of the order and the server has no use
  for it.
- The **workshop is never shown the stitched version.** The admin has to
  digitise the real artwork; a stylised render of a file somebody must trace is
  worse than no render at all.

## Alternatives considered

- **Render it server-side with `sharp` and store it beside the original.**
  Faster for the customer and the obvious thing to reach for. Rejected: it
  means decoding customer artwork into server memory on a request, it creates a
  second artefact of a private file that then needs its own authorisation and
  its own lifecycle, and ADR-024 keeps design files byte-for-byte precisely so
  there is exactly one answer to "what did the customer send". A derived render
  is a schema change and deserves its own ADR; it is not a side effect of
  wanting a nicer preview.
- **A CSS filter stack or an SVG `feTurbulence` / `feDisplacementMap`.** Cheap
  and needs no pixel loop. Rejected because neither can do the part that
  matters: the palette reduction is per-pixel and quantised, and a displacement
  map distorts the artwork rather than lighting it — it makes a logo look
  *damaged*, which is the opposite of the message.
- **WebGL.** The right tool if this ever becomes real-time or much larger. At
  512 pixels square the JavaScript loop is a few milliseconds, and a shader
  would add a context, a fallback path and a dependency to save none of them.
- **Applying it to the 3D model's texture too.** Tempting and deferred: the
  model's UV compositing (ADR-036) already takes the artwork through a
  different path, and doing this properly there means the stitch direction
  should follow the garment's surface rather than the screen. Listed as not
  done rather than done badly.

## Consequences

- Positive: the conversation about whether a design suits thread happens before
  the order rather than in a complaint afterwards — which is the workshop's
  single most common support cost.
- Positive: nothing about storage, authorisation or the private bucket changed.
  The feature added no server surface at all.
- Positive: the model is unit tested, which a visual effect usually is not,
  because the rules are separated from the canvas. Two real modelling errors
  were caught that way and are recorded in the tests as the properties they
  violate.
- Negative: it is a per-pixel loop in JavaScript on the main thread. At
  `PREVIEW_MAX_PX` it is a few milliseconds and there is one of them per
  upload; at four times the size it would need a worker.
- Negative: the effect is an *impression* of embroidery, not a simulation of
  it. It does not know stitch density, underlay, pull compensation or what the
  digitiser will actually do. The copy under it says what it is, and the
  workshop's quote remains the authority.
- Negative: a canvas tainted by a cross-origin preview silently loses the
  effect. Handled — the original is shown — but if storage ever moves to a CDN
  host, the CORS headers on signed URLs become load-bearing for this feature.
