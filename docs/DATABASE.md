# DATABASE.md

> The database design source of truth. This is a **design document**, not an ORM schema.
> `prisma/schema.prisma` is derived from it, and the two must be changed together.
> Rules the data enforces are in `BUSINESS-RULES.md`. Rationale is in `DECISIONS.md`.

---

## 1. Conventions

| Convention        | Rule                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine            | PostgreSQL                                                                                                                                                           |
| Primary keys      | `id`, UUID v7 (time-ordered, index-friendly, non-enumerable)                                                                                                         |
| Human identifiers | `orderNumber`, `quoteNumber`, `requestNumber` — short, unique, sequence-backed, shown to users. Never a raw ID in a URL a customer sees. Implemented as `next_order_number()`, `next_request_number()` and `next_quote_base()` over `order_number_seq` / `request_number_seq` / `quote_number_seq` (ADR-023). The quote sequence yields the **base** of a family — `Q-1042`, `Q-1042-v2` — so a revision reuses its predecessor's base and only the version suffix moves. |
| Timestamps        | `createdAt`, `updatedAt` on every mutable table; `timestamptz`, stored UTC                                                                                           |
| Soft delete       | Only where history matters: products, categories, gallery items, users. Everything else is hard-deleted. `deletedAt IS NULL` is part of the relevant unique indexes. |
| Archiving         | `archivedAt` on `orders`, `custom_requests`, `quotes` and `reviews` hides a row from the **workshop's lists only**. It is not a soft delete and no customer query reads it. See ADR-034.                |
| Money             | `INTEGER` minor units (centimes) plus a `currency` char(3) on any table that stores an independent total. Never `float`. Never `numeric` for money.                  |
| Naming            | `snake_case` in the database, `camelCase` in application code (Prisma `@map`)                                                                                        |
| Enums             | Native Postgres enums for closed sets that the application branches on; lookup tables for sets the admin manages                                                     |
| Booleans          | Positive naming: `isActive`, not `isDisabled`                                                                                                                        |
| Text              | `text`, never `varchar(n)`, except where a real domain limit exists                                                                                                  |
| Ordering          | Explicit `position` integers for anything the admin reorders                                                                                                         |

### The three structural rules

1. **Snapshot at commitment.** Order lines, quote lines and quote totals copy the values that
   applied at the moment of commitment. A later price change must not alter a placed order.
2. **Configuration is an entity, not a JSON blob.** A customisation is queryable, reusable and
   validatable. JSON is used in exactly four places, listed in section 16.
3. **Ownership is a column, not a convention.** Every customer-owned row carries `userId` (or
   reaches one through exactly one hop), so a repository can scope the query itself.

---

## 2. Entity Map

```
                 ┌──────────┐
                 │   User   │
                 └────┬─────┘
       ┌──────────────┼───────────────┬──────────────┬─────────────┐
       │              │               │              │             │
  ┌────▼────┐   ┌─────▼─────┐   ┌─────▼──────┐  ┌────▼─────┐  ┌────▼────┐
  │ Address │   │  Session  │   │ DesignFile │  │   Cart   │  │  Order  │
  └─────────┘   └───────────┘   └─────┬──────┘  └────┬─────┘  └────┬────┘
                                      │              │             │
                              ┌───────▼──────────────▼─────────────▼──────┐
                              │        CustomizationConfig                │
                              │  (product, variant, placement, sizes,     │
                              │   text, font, thread colours, files)      │
                              └───────────────────┬───────────────────────┘
                                                  │
   ┌──────────────┐      ┌──────────────┐    ┌────▼────────────┐
   │   Product    │◄─────┤ProductVariant│    │ CustomRequest   │
   └──────┬───────┘      └──────────────┘    └────┬────────────┘
          │                                       │
   ┌──────▼───────┐                          ┌────▼────┐
   │  Category    │                          │  Quote  │──► QuoteItem
   └──────────────┘                          └────┬────┘
                                                  │ accepted
                                             ┌────▼────┐
                                             │  Order  │──► OrderItem
                                             └────┬────┘    OrderStatusHistory
                                                  │         OrderAddress
                                                  └────────► Payment
```

The load-bearing idea: **`CustomizationConfig` is the shared spine.** The same entity is
referenced by a cart line, a custom-request line and an order line. That is what makes hybrid
customisation, reorder and saved designs cheap instead of a second system. See ADR-003.

---

## 3. Enums

```
UserRole                CUSTOMER | STAFF | ADMIN
UserStatus              ACTIVE | SUSPENDED | DELETED

ProductStatus           DRAFT | ACTIVE | ARCHIVED
StockPolicy             TRACK | DONT_TRACK | MADE_TO_ORDER

CartStatus              ACTIVE | CONVERTED | ABANDONED | INVALIDATED
CartKind                STANDARD | QUOTE_BOUND
LineKind                STOCK | CUSTOM | FEE

OrderStatus             AWAITING_PAYMENT | AWAITING_CONFIRMATION | CONFIRMED
                        | DESIGN_REVIEW | IN_PRODUCTION | READY | SHIPPED
                        | DELIVERED | ON_HOLD | CANCELLED | REFUNDED
PaymentStatus           UNPAID | DEPOSIT_PAID | PAID | PARTIALLY_REFUNDED | REFUNDED | FAILED
PaymentMethod           COD | BANK_TRANSFER | CCP | ONLINE
PaymentTxStatus         PENDING | SUCCEEDED | FAILED | CANCELLED | REFUNDED
DeliveryType            HOME | DESK

RequestStatus           DRAFT | SUBMITTED | IN_REVIEW | NEEDS_INFO | QUOTED
                        | ACCEPTED | REJECTED | EXPIRED | CONVERTED | CANCELLED
RequestSource           BUILDER | PRODUCT_PAGE | CONTACT_FORM | ADMIN
PricingMode             FIXED | QUOTE

QuoteStatus             DRAFT | SENT | VIEWED | ACCEPTED | REJECTED
                        | EXPIRED | CANCELLED | SUPERSEDED
QuoteLineKind           PRODUCT | EMBROIDERY | SETUP_FEE | DIGITIZING | RUSH_FEE
                        | SHIPPING | DISCOUNT | OTHER

DesignFileStatus        PENDING | READY | REJECTED | QUARANTINED
DesignFileRole          PRIMARY | REFERENCE

ReviewStatus            PENDING | APPROVED | REJECTED

CouponType              PERCENTAGE | FIXED_AMOUNT | FREE_SHIPPING
CouponScope             ALL | PRODUCTS | CATEGORIES | COLLECTIONS

NotificationChannel     EMAIL | WHATSAPP | SMS | IN_APP
NotificationStatus      PENDING | SENT | FAILED | SKIPPED

ActorType               CUSTOMER | ADMIN | SYSTEM
HomepageSectionType     HERO | MARQUEE | CATEGORY_GRID | HOW_IT_WORKS
                        | CUSTOM_CTA | FEATURED_PRODUCTS | GALLERY | WHY_US
                        | REVIEWS | SOCIAL | BANNER | FINAL_CTA
SettingType             STRING | NUMBER | BOOLEAN | JSON | MONEY
```

**`OrderStatus` deliberately contains no quote states.** A quote precedes an order's existence;
`QUOTE_SENT` and `QUOTE_ACCEPTED` belong to `RequestStatus` and `QuoteStatus`. See ADR-004.

---

## 4. Identity and Access

`users`, `sessions`, `accounts` and `verification` are **Better Auth 1.7.2's core schema**, not
our own design. The field names and semantics below are the ones the library's Prisma adapter
queries by, so they are not renamed to house style; our domain columns sit alongside them on
`users`. See ADR-006 and `SECURITY.md` section 2 for the trade-offs this carries.

Three points that decide how the rest of the application reads these tables:

- **There is no `users.passwordHash`.** The Argon2id credential hash lives on the credential
  account row — `accounts.password` where `providerId = 'credential'`. One hash, one place.
- **`sessions.token` is stored as issued, not hashed.** Better Auth looks a session up by equality
  on the raw value and offers no supported alternative, so this remains the accepted trade-off in
  `SECURITY.md` section 2.1. **The two credentials in `verification` are not the same case.** A
  reset token lives in `verification.identifier` and is SHA-256 hashed by `storeIdentifier`; an
  email-verification code lives in `verification.value` and is encrypted under
  `BETTER_AUTH_SECRET` by `storeOTP`, because an 8-digit code has too little entropy for a hash to
  protect. Both are supported library options. See ADR-020 and ADR-021.
- **Primary keys stay `uuidv7()`**, like every other table. `advanced.database.generateId: false`
  makes Better Auth omit `id` from every insert so PostgreSQL generates it.

### `users`

| Column                | Type        | Constraints                                | Notes                                                        |
| --------------------- | ----------- | ------------------------------------------ | ------------------------------------------------------------ |
| id                    | uuid        | PK                                         | `uuidv7()`                                                   |
| name                  | text        | NOT NULL                                   | Better Auth. A single display name; every form collects one  |
| email                 | citext      | NOT NULL, UNIQUE where `deletedAt IS NULL` | Better Auth. Required — guests have no user row              |
| emailVerified         | boolean     | NOT NULL, default false                    | Better Auth. Written by the verification flow                |
| image                 | text        | NULL                                       | Better Auth. Unused in V1; no avatar upload exists           |
| phone                 | text        | INDEX                                      | E.164, normalised on write. Primary contact channel          |
| phoneVerifiedAt       | timestamptz | NULL                                       | V2 phone OTP, written by us, not by Better Auth              |
| role                  | UserRole    | NOT NULL, default CUSTOMER                 | Ours, not the library's — see ADR-006                        |
| status                | UserStatus  | NOT NULL, default ACTIVE                   |                                                              |
| marketingOptIn        | boolean     | NOT NULL, default false                    | Explicit consent, never pre-checked                          |
| lastLoginAt           | timestamptz | NULL                                       |                                                              |
| createdAt / updatedAt | timestamptz | NOT NULL                                   | Better Auth requires both                                    |
| deletedAt             | timestamptz | NULL                                       | Anonymisation on erasure request                             |

Indexes: `(email) unique partial where deletedAt IS NULL` (named `users_email_active_key`),
`(phone)`, `(role) where role <> 'CUSTOMER'`, `(createdAt desc)`.

Removed in the Better Auth reconciliation: `passwordHash` (moved to `accounts.password`),
`firstName` / `lastName` (replaced by `name` — nothing consumed them, the checkout and account
forms in `UX.md` collect a full name, and addresses carry their own `fullName` for the recipient)
and `emailVerifiedAt` (Better Auth records verification as the `emailVerified` boolean and would
never write a timestamp; a column that stays NULL for ever is worse than no column, and
verification events are `audit_logs`' job).

### `sessions`

`id`, `userId` FK cascade, `token` (unique — **the value as issued**, the same string the cookie
carries), `expiresAt`, `ipAddress`, `userAgent`, `createdAt`, `updatedAt`.
Indexes: `(token) unique`, `(userId)`, `(expiresAt)` for the cleanup job.

There is no `lastActiveAt`: Better Auth expresses rolling refresh by moving `expiresAt` and
`updatedAt`. Deleting the row revokes the session immediately, which is the reason sessions are in
the database at all.

### `accounts`

Better Auth's credential and provider links. **Not empty in V1** — every password account has a row
here, with `providerId = 'credential'` and `issuer = 'local:credential'`.

| Column                | Type        | Constraints | Notes                                                          |
| --------------------- | ----------- | ----------- | -------------------------------------------------------------- |
| id                    | uuid        | PK          |                                                                |
| userId                | uuid        | FK cascade  |                                                                |
| accountId             | text        | NOT NULL    | The id at the provider. For `credential`, the user's own id    |
| providerId            | text        | NOT NULL    | `credential` for email and password; a provider slug for OAuth |
| issuer                | text        | NOT NULL    | Identity namespace, and half the account key. `local:credential` for email and password; `local:oauth:<provider>` for OAuth. **Load-bearing** — see ADR-019 |
| accessToken           | text        | NULL        | OAuth only                                                     |
| refreshToken          | text        | NULL        | OAuth only                                                     |
| idToken               | text        | NULL        | OAuth only                                                     |
| accessTokenExpiresAt  | timestamptz | NULL        | OAuth only                                                     |
| refreshTokenExpiresAt | timestamptz | NULL        | OAuth only                                                     |
| scope                 | text        | NULL        | OAuth only                                                     |
| password              | text        | NULL        | **The Argon2id hash.** NULL on an OAuth row                    |
| createdAt / updatedAt | timestamptz | NOT NULL    |                                                                |

Indexes: `(issuer, accountId) unique`, `(userId)`.

**The unique key is `(issuer, accountId)`, not `(providerId, accountId)`** — Better Auth declares
that index itself, and the `local:` prefixes are what stop a local provider id colliding with an
OAuth one. `issuer` is `NOT NULL` because `updatePassword` filters on it: a credential row without
one matches zero rows, so a password reset would report success while changing nothing. Both were
corrected in Phase 3 after reading the installed package (ADR-019).

`password` is a customer secret and never leaves the repository layer: it belongs to the same
never-serialise list as `internalNotes` and `storageKey` (`SECURITY.md` section 10).

### `verification`

Better Auth's single generic table for every short-lived credential — email verification, password
reset, and anything a later plugin adds.

`id`, `identifier` (what the value is for, e.g. the email address being verified), `value` (the
token **as issued**), `expiresAt`, `createdAt`, `updatedAt`. Indexes: `(identifier)`,
`(expiresAt)` for the cleanup job.

**Single use is enforced by Better Auth's atomic consumption** (`consumeVerificationValue`), which
deletes the row in the same operation that reads it. There is no `consumedAt` column and no
verification type enum, and the old typed `verification_tokens` table has been dropped rather than
kept alongside: two competing verification systems is exactly the failure mode where one of them
stops being checked.

What actually lands here in V1, verified against the installed package:

| Row                     | `identifier`                        | `value`                          | Expiry |
| ----------------------- | ----------------------------------- | -------------------------------- | ------ |
| Password reset          | `reset-password:<token>`, hashed    | the user id                      | 1 hour |
| Email verification      | `email-verification-otp-<address>`, hashed | the code, encrypted, plus an attempt counter | 15 min |

- **`identifier` is always stored as a SHA-256 digest**, never in the readable forms above, so the
  table yields neither a usable reset token nor the address a code belongs to (ADR-020).
- **The verification code in `value` is encrypted, not hashed.** At ~27 bits, a digest would be
  brute-forced offline in milliseconds; encryption under a secret held outside the database is what
  actually protects it (ADR-021).
- **Both are single-use**, consumed by `consumeVerificationValue`, which deletes the row in the
  operation that reads it. Email verification additionally allows three attempts before the
  identifier is locked out.
- Phase 3 originally recorded that email verification wrote no row at all, because the default
  flow is a stateless JWT. Phase 3.1 replaced that flow precisely because nothing stored means
  nothing consumed. See ADR-021.

### `addresses`

| Column                | Type                        | Notes                                                       |
| --------------------- | --------------------------- | ----------------------------------------------------------- |
| id                    | uuid PK                     |                                                             |
| userId                | uuid FK cascade             | Owner                                                       |
| label                 | text                        | "Home", "Office"                                            |
| fullName / phone      | text NOT NULL               | The recipient, who may not be the account holder            |
| wilayaCode            | int FK -> wilayas.code      |                                                             |
| communeId             | uuid FK -> communes.id NULL |                                                             |
| communeName           | text NOT NULL               | Denormalised so an address survives a reference-data change |
| addressLine           | text NOT NULL               |                                                             |
| postalCode            | text NULL                   |                                                             |
| notes                 | text NULL                   | Landmarks; genuinely used in Algerian delivery              |
| isDefault             | boolean                     | Partial unique index: one default per user                  |
| createdAt / updatedAt |                             |                                                             |

Indexes: `(userId)`, `(userId) unique where isDefault`.

### `wilayas` — reference

`code` int PK (1–58), `nameFr`, `nameAr`, `isActive`. Seeded, not user-editable.

### `communes` — reference

`id`, `wilayaCode` FK, `nameFr`, `nameAr`, `isActive`. Index `(wilayaCode)`.
Free-text `communeName` on addresses and orders remains authoritative, so a missing commune never
blocks an order.

---

## 5. Catalogue

### `categories`

`id`, `slug` (unique, partial on `deletedAt IS NULL`), `name`, `description`, `imageKey`,
`parentId` (self FK, one level in V1), `position`, `seoTitle`, `seoDescription`, `isActive`,
`createdAt`, `updatedAt`, `deletedAt`.
Indexes: `(slug) unique partial`, `(parentId, position)`, `(isActive)`.

Editable from `/admin/categories` since Phase 14.13; before that the only way to
make one was a SQL client, and the product form carried a warning saying so.
`position` orders the chip row on `/shop`; `isActive` off removes the category
from the chips and makes `/shop/c/<slug>` a 404, which is why a category holding
live products refuses to be switched off (`BUSINESS-RULES.md` 11.9). `parentId`
is still unused — V1 has one level — and nothing deletes a category, so
`deletedAt` remains a column for a future that has not happened.

**A renamed category leaves no redirect**, unlike a renamed product: there is no
`category_redirects` table and deliberately so (11.10).

`translations` (JSONB, nullable) carries the English overlay — see the note under `products`; the
same column exists on `products`, `gallery_items` and `banners`.

### `rate_limits`

`key` text PK, `count` integer NOT NULL default 0, `expiresAt` timestamptz NOT NULL.
Indexes: `(expiresAt)`. CHECK: `count >= 0`.

One fixed window of one rate-limited action, for one subject. **The window's start is part of the
key** — `<action>:<subject kind>:<subject>:<window start in seconds>` — which turns incrementing a
counter into a single atomic `INSERT … ON CONFLICT DO UPDATE` rather than a read-modify-write that
two simultaneous requests can both win. See `SECURITY.md` section 9 and the migration for the
trade-offs of a fixed window.

Rows are dead the moment their window closes; the notification dispatcher sweeps them on the same
tick rather than earning a scheduled job of its own. The table is deliberately absent from
`prisma/demo-seed.sql`: a demonstration database should start with nobody throttled.

### `collections` _(V1.5)_

Same shape as categories minus the hierarchy, plus `publishedAt`. Joined through
`product_collections (productId, collectionId, position)`.

### `products`

| Column                                   | Type                           | Notes                                                                        |
| ---------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| id                                       | uuid PK                        |                                                                              |
| slug                                     | text                           | UNIQUE partial. Immutable after publish; a change requires a redirect record |
| name                                     | text NOT NULL                  |                                                                              |
| subtitle                                 | text NULL                      | One editorial line under the title                                           |
| description                              | text NOT NULL                  | Markdown                                                                     |
| categoryId                               | uuid FK RESTRICT               | A product has one primary category                                           |
| status                                   | ProductStatus                  | DRAFT / ACTIVE / ARCHIVED                                                    |
| basePrice                                | integer NOT NULL               | Minor units. Variants may override                                           |
| compareAtPrice                           | integer NULL                   | Struck-through original; must exceed the effective price                     |
| currency                                 | char(3) NOT NULL               | Default DZD                                                                  |
| stockPolicy                              | StockPolicy                    | MADE_TO_ORDER for blanks that are never held                                 |
| material                                 | text NULL                      |                                                                              |
| careInstructions                         | text NULL                      |                                                                              |
| embroideryDetails                        | text NULL                      |                                                                              |
| isFeatured / isBestSeller / isNewArrival | boolean                        | Admin flags in V1                                                            |
| isCustomizable                           | boolean NOT NULL default false | Enables the hybrid flow                                                      |
| customizationProfileId                   | uuid FK NULL                   | Which placements and options apply                                           |
| ratingAverage                            | integer NULL                   | Denormalised, x100 (e.g. 465 = 4.65)                                         |
| ratingCount                              | integer NOT NULL default 0     | Denormalised; recomputed on moderation                                       |
| seoTitle / seoDescription / ogImageKey   |                                |                                                                              |
| translations                             | jsonb NULL                     | English overlay, keyed by locale then column. CHECK: object or NULL. ADR-040 |
| _(models)_                               | see `product_models_3d`        | The garment's `.glb`, read by the product page's 360° view since Phase 14.15 |
| publishedAt                              | timestamptz NULL               |                                                                              |
| createdAt / updatedAt / deletedAt        |                                |                                                                              |

Indexes: `(slug) unique partial`, `(status, publishedAt desc)`, `(categoryId, status)`,
`(isFeatured) where isFeatured and status='ACTIVE'`, `(isNewArrival) partial`,
GIN full-text on `(name, subtitle, description)` for search.

Rating is denormalised deliberately: product listings render a rating on every card, and
aggregating reviews per card is the classic N+1 in this kind of catalogue. It is recomputed in the
same transaction that approves, rejects or deletes a review — never on a schedule.

### `product_options` / `product_option_values` / `product_variants` / `product_variant_option_values`

A generic option model rather than fixed size and colour columns. See ADR-007.

- `product_options`: `id`, `productId`, `name` ("Size", "Colour"), `position`.
  Unique `(productId, name)`.
- `product_option_values`: `id`, `optionId`, `value` ("L", "Black"), `hexColor` (NULL except
  colour), `position`. Unique `(optionId, value)`.
- `product_variants`: `id`, `productId`, `sku` (unique), `priceOverride` (NULL = inherit
  `basePrice`), `compareAtPriceOverride`, `stockQuantity` int NOT NULL default 0,
  `reservedQuantity` int NOT NULL default 0, `lowStockThreshold`, `weightGrams`, `isActive`,
  `position`. Check `stockQuantity >= 0`, `reservedQuantity >= 0`.
- `product_variant_option_values`: `(variantId, optionValueId)` composite PK, plus a unique index
  on `(variantId, optionId)` derived through the value, so a variant cannot hold two values of
  the same option.

Why generic: caps have one size, tote bags have no size, workwear has size plus fit. Fixed
columns would force nullable placeholders and a rewrite the first time a third axis appears.
The admin UI constrains V1 to Size and Colour; the schema does not.

### `product_images`

`id`, `productId`, `variantId` (NULL = applies to the product), `storageKey`, `alt` NOT NULL,
`position`, `width`, `height`, `blurDataUrl`, `isPrimary`.
Indexes: `(productId, position)`, partial unique `(productId) where isPrimary`.
`alt` is NOT NULL at the database level because accessibility that depends on discipline decays.

### `product_image_placement_anchors`

Where a design sits on a given photograph for a given placement. This is what makes the static
preview deterministic rather than guessed at render time.

| Column                | Type                            | Notes                                                                                     |
| --------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| id                    | uuid PK                         |                                                                                           |
| productImageId        | uuid FK cascade                 | The photograph the anchor is defined against                                              |
| placementId           | uuid FK cascade                 | Which placement this anchor describes                                                     |
| xPercent              | numeric(5,2) NOT NULL           | Centre X, as a percentage of image width                                                  |
| yPercent              | numeric(5,2) NOT NULL           | Centre Y, as a percentage of image height                                                 |
| widthPercent          | numeric(5,2) NOT NULL           | Design width at the placement's reference embroidery size, as a percentage of image width |
| rotationDeg           | numeric(5,2) NOT NULL default 0 | Rotation applied to the overlay                                                           |
| createdAt / updatedAt |                                 |                                                                                           |

Unique `(productImageId, placementId)`. Index `(productImageId)`.

Percentages rather than pixels, so the same anchor is correct at every rendered image size. The
overlay scales linearly from `widthPercent` by the ratio of the selected embroidery size to the
placement's reference size, which keeps the preview a pure client-side calculation with no server
image processing. See ADR-011.

A placement with no anchor for the current image renders no overlay; it never guesses.

### `tags` / `product_tags`

`tags`: `id`, `slug` unique, `name`. `product_tags`: `(productId, tagId)` composite PK.

### `product_redirects`

`id`, `fromSlug` unique, `productId`, `createdAt`. Keeps SEO intact when a slug changes.

**Written by the admin's product form** (Phase 14.5), in the same transaction as the rename — a
rename that lost its redirect is a 404 on a URL somebody has already linked to, and the old slug
cannot be reconstructed afterwards. Renaming a product back to a slug it used before deletes that
slug's redirect row, because a slug in use cannot also be a redirect to somewhere.

### `inventory_adjustments`

The stock ledger. `id`, `variantId`, `delta` (signed, never zero), `resultingQuantity`, `reason`
(`RECEIVED` | `COUNT` | `DAMAGED` | `RETURNED` | `CORRECTION`), `note`, `actorUserId`, `createdAt`.

Every manual change to `product_variants.stock_quantity` writes one row, in the same transaction as
the change. Reservations, shipment decrements and cancellation releases do **not** — those already
have an order behind them and are explained by `order_status_history`.

Three properties, all deliberate and all covered by ADR-029:

- **Append-only.** No update path, no delete path. A mistaken adjustment is corrected by a
  compensating adjustment with reason `CORRECTION`.
- **`resultingQuantity` is denormalised.** Replaying deltas reconstructs a count only if nothing
  else ever touched the column, and shipments do.
- **`actorUserId` is `ON DELETE SET NULL`.** The movement happened even if the account that made it
  is later removed; the ledger outlives the staff list.

Constraints: `delta <> 0` and `resultingQuantity >= 0`. Indexed by `(variantId, createdAt DESC)`,
which is the only way it is read.

---

## 6. Customisation

The reference data the builder is assembled from. All admin-managed; none hard-coded.

### `placements`

`id`, `code` unique ("LEFT_CHEST"), `name`, `description`, `diagramImageKey`,
`maxWidthMm`, `maxHeightMm`, `position`, `isActive`.

### `embroidery_sizes`

`id`, `code`, `name` ("Small"), `description` ("up to 8 cm"), `maxWidthMm`, `maxHeightMm`,
`basePrice` integer, `position`, `isActive`.

### `thread_colors`

`id`, `code`, `name` ("Ivory"), `hexColor`, `position`, `isActive`.

### `embroidery_fonts`

`id`, `name`, `previewImageKey`, `cssFontFamily` NULL, `position`, `isActive`.

### Reference data is deactivated, never deleted

`placements`, `embroidery_sizes`, `thread_colors` and `embroidery_fonts` are **soft-deleted** by
setting `isActive = false`. There is no hard delete, and the admin UI offers only "deactivate".
A deactivated row disappears from the builder immediately but remains resolvable for every
historical configuration that references it.

This alone is not sufficient — a rename or a price change on an active row would still alter how
an old order reads. Historical display therefore uses the snapshot columns written at freeze time
(below), and the foreign keys are retained for reporting only.

### `customization_profiles`

`id`, `name`, `description`, `isDefault`, `isActive`.
A reusable bundle of what is allowed. Assigned to products and used by the standalone builder.

Joins:

- `profile_placements`: `(profileId, placementId)`, `priceModifier` integer default 0, `position`
- `profile_embroidery_sizes`: `(profileId, embroiderySizeId)`, `priceModifier`, `position`
- `profile_product_types`: `(profileId, categoryId)` — which categories the profile serves

### `customization_configs` — the shared spine

| Column                                 | Type                       | Notes                                                       |
| -------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| id                                     | uuid PK                    |                                                             |
| ownerUserId                            | uuid FK NULL               | NULL while anonymous; set on identification                 |
| productId                              | uuid FK NULL               | NULL for a free-text product type                           |
| variantId                              | uuid FK NULL               |                                                             |
| freeformProductType                    | text NULL                  | The "Other" path; forces QUOTE mode                         |
| placementId                            | uuid FK NULL               |                                                             |
| customPlacementNote                    | text NULL                  | Non-null forces QUOTE mode                                  |
| embroiderySizeId                       | uuid FK NULL               |                                                             |
| embroideryWidthMm / embroideryHeightMm | integer NULL               | Exact dimensions when supplied                              |
| embroideryText                         | text NULL                  | Max 120 chars                                               |
| embroideryFontId                       | uuid FK NULL               |                                                             |
| threadColorCount                       | integer NOT NULL default 1 | Drives price; derived from the join, stored for query speed |
| instructions                           | text NULL                  | Max 2000 chars                                              |
| pricingMode                            | PricingMode NOT NULL       | Computed on save by the domain layer, never client-supplied |
| pricingModeReason                      | text NULL                  | Why quote mode applies; shown to the customer               |
| estimateMin / estimateMax              | integer NULL               | Snapshot of the estimate shown at configuration time        |
| isTemplate                             | boolean default false      | A saved, reusable configuration (V1.5)                      |
| label                                  | text NULL                  | Customer's name for a saved configuration                   |
| frozenAt                               | timestamptz NULL           | Non-null means the configuration is immutable               |
| clonedFromConfigId                     | uuid FK NULL               | Set when this configuration was cloned from a frozen one    |
| createdAt / updatedAt                  |                            |                                                             |

**Display snapshots**, written at the moment the configuration freezes and never afterwards:

| Column              | Type                         | Notes                                           |
| ------------------- | ---------------------------- | ----------------------------------------------- |
| productNameSnapshot | text NULL                    | The product's name as it read when frozen       |
| placementLabel      | text NULL                    | e.g. "Left chest"                               |
| embroiderySizeLabel | text NULL                    | e.g. "Small (up to 8 cm)"                       |
| threadColorNames    | text[] NOT NULL default '{}' | Ordered, matching `customization_thread_colors` |
| fontLabel           | text NULL                    |                                                 |

Check: at least one of `productId` and `freeformProductType` is non-null.
Check: `frozenAt` non-null implies `placementLabel` is non-null when `placementId` is non-null.
Indexes: `(ownerUserId, createdAt desc)`, `(productId)`, `(clonedFromConfigId)`.

**Immutability rule.** A configuration freezes when it becomes referenced by:

- an **order item**, or
- **any quote in `SENT`, `VIEWED` or `ACCEPTED`**.

Freezing writes `frozenAt` and populates every snapshot column in the same transaction. A frozen
configuration cannot be edited: a modification attempt clones it (setting `clonedFromConfigId`),
edits the clone, and — where a quote was involved — prices the clone as a new quote version.

The freeze point is quote **send**, not acceptance, because a quote is immutable from the moment
it is sent and must describe something that is equally immutable. See ADR-010.

Live rendering of an unfrozen configuration reads the reference tables. Historical rendering of a
frozen configuration reads the snapshot columns only. This is the reason an order placed a year
ago still reads exactly as the customer bought it.

### `customization_thread_colors`

`(configId, threadColorId)` composite PK, `position`. `threadColorCount` on the config is kept in
step within the same transaction.

### `customization_files`

`(configId, designFileId)` composite PK, `role` DesignFileRole, `position`.
A join rather than a direct FK, so one uploaded file can back several configurations — which is
exactly what reorder and the saved-design library need.

### `design_files`

| Column           | Type                 | Notes                                                                                     |
| ---------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| id               | uuid PK              |                                                                                           |
| ownerUserId      | uuid FK NULL         | Set for a signed-in customer; NULL for a guest                                            |
| ownerTokenHash   | text NULL            | SHA-256 of the guest's anonymous token — the same token that identifies a guest cart      |
| storageKey       | text NOT NULL UNIQUE | Private bucket key. Never a URL                                                           |
| originalFilename | text NOT NULL        | Sanitised; never used as the storage key                                                  |
| mimeType         | text NOT NULL        | Server-detected, not client-declared                                                      |
| extension        | text NOT NULL        |                                                                                           |
| byteSize         | integer NOT NULL     |                                                                                           |
| checksumSha256   | text NOT NULL        | Deduplication and integrity                                                               |
| width / height   | integer NULL         | Rasters only                                                                              |
| pageCount        | integer NULL         | PDFs                                                                                      |
| status           | DesignFileStatus     | PENDING until server validation passes                                                    |
| rejectionReason  | text NULL            |                                                                                           |
| previewKey       | text NULL            | Downscaled raster thumbnail, PNG/JPG only in V1; null for SVG and PDF. Never the original |
| label            | text NULL            | Customer's name for a saved design (V1.5)                                                 |
| savedAt          | timestamptz NULL     | Non-null means it is in the design library                                                |
| createdAt        | timestamptz          |                                                                                           |
| deletedAt        | timestamptz NULL     |                                                                                           |

Checks: exactly one of `ownerUserId` and `ownerTokenHash` is set on a live row. A file whose owner
account was erased (`ON DELETE SET NULL`) is allowed to have neither, and is then unreachable —
the correct outcome for a deleted account.
Indexes: `(ownerUserId, createdAt desc)`, `(ownerTokenHash, createdAt desc)`,
`(createdAt) where status = 'PENDING'` for the sweeper, `(checksumSha256)`.

A separate saved-design table is not needed: a design file with `savedAt` set **is** a saved
design. One fewer entity, one fewer synchronisation problem.

**Ownership from the first moment.** A row is created at *presign* time, before any request or
configuration exists to hang authorisation on, so it must already know whose it is — otherwise an
anonymous upload would be unowned, and an unowned row is one anybody can claim. `ownerTokenHash`
applies the ownership model `carts` already uses (section 7: exactly one of `userId` and
`anonymousToken`) to a second table; it is the **same** guest token, so one browser is one guest
across uploads, cart and orders. It is stored hashed, unlike `carts.anonymousToken`, because a
database dump should not be a set of usable bearer credentials.

**The lifecycle.** `PENDING` on presign; `READY` only after the server has read the stored object's
own bytes; `REJECTED` with a reason when validation fails, and the object deleted; `QUARANTINED` is
reserved for the malware scan of V1.5. A `PENDING` row whose upload never arrived is swept after 24
hours, matching the bucket's own lifecycle rule on the `quarantine/` prefix (`SECURITY.md`
section 7). The application owns the row half of that sweep, because a bucket rule cannot see the
database; it is a **function**, `sweepStalePendingUploads`, and the cron that calls it arrives with
the rest of the scheduled jobs in Phase 8A.

---

## 7. Cart

### `carts`

`id`, `kind` CartKind NOT NULL default STANDARD, `userId` FK NULL, `anonymousToken` text unique
NULL, `status` CartStatus, `currency`, `quoteId` FK NULL, `quoteValidUntil` timestamptz NULL,
`couponId` FK NULL, `couponCode` text NULL, `lastActivityAt`, `expiresAt`, `convertedOrderId` FK
NULL, `createdAt`, `updatedAt`.

Checks: exactly one of `userId` and `anonymousToken` is non-null; `kind='QUOTE_BOUND'` implies
`quoteId` and `userId` are non-null and `couponId` is null; `kind='STANDARD'` implies `quoteId`
is null.
Indexes: partial unique `(userId) where kind='STANDARD' and status='ACTIVE'`,
partial unique `(quoteId) where quoteId is not null`, `(anonymousToken) unique`,
`(status, lastActivityAt)` for abandonment, `(quoteValidUntil) where kind='QUOTE_BOUND' and
status='ACTIVE'` for the invalidation job.

The anonymous token lives in an `HttpOnly` cookie. On login the guest cart merges into the user's
active **standard** cart; conflicts resolve by summing quantities, capped at available stock. A
quote-bound cart never participates in a merge.

These checks and partial indexes are **implemented**, in the Phase 8 migration
`20260905180000_commerce_sequences_and_invariants`. Prisma's schema language cannot express a
check constraint or a partial index, so they are raw SQL and are invisible to `schema.prisma`;
they are no less real for that, and `carts_owner_check` is what makes "exactly one owner" a fact
rather than a convention.

### Two kinds of cart

|                     | `STANDARD`                         | `QUOTE_BOUND`                                    |
| ------------------- | ---------------------------------- | ------------------------------------------------ |
| Created by          | Adding any item                    | Accepting a quote                                |
| Contents            | Stock and fixed-price custom lines | Exactly the accepted quote's lines, nothing else |
| Lines addable       | Yes                                | **No**                                           |
| Quantities editable | Yes                                | No                                               |
| Pricing             | Live from the catalogue            | Locked to the quote                              |
| Shipping            | Resolved from the rate table       | The quote's `SHIPPING` lines                     |
| Coupons             | Allowed (V1.5)                     | **Disabled**                                     |
| Deposit             | From the current rule              | Copied from the quote                            |
| Expiry              | Abandonment TTL                    | `acceptedAt + acceptanceValidityDays`            |

A customer may hold one active standard cart and any number of quote-bound carts simultaneously.
They are checked out separately. Behaviour is specified in `BUSINESS-RULES.md` section 5A. See
ADR-015.

### `cart_items`

| Column                | Type             | Notes                                              |
| --------------------- | ---------------- | -------------------------------------------------- |
| id                    | uuid PK          |                                                    |
| cartId                | uuid FK cascade  |                                                    |
| kind                  | LineKind         | STOCK, CUSTOM or FEE                               |
| productId             | uuid FK NULL     |                                                    |
| variantId             | uuid FK NULL     | Required when kind = STOCK                         |
| customizationConfigId | uuid FK NULL     | Required when kind = CUSTOM                        |
| quoteItemId           | uuid FK NULL     | The quote line this was derived from               |
| nameSnapshot          | text NULL        | Required when kind = FEE ("Setup fee", "Rush fee") |
| lockedUnitPrice       | integer NULL     | Non-null only in a quote-bound cart                |
| quantity              | integer NOT NULL | Check > 0 and <= 999; always 1 for FEE             |
| position              | integer          | Preserves the quote's line order                   |
| addedAt               | timestamptz      |                                                    |

Checks: `kind='STOCK'` implies `variantId` non-null; `kind='CUSTOM'` implies
`customizationConfigId` non-null; `kind='FEE'` implies `nameSnapshot` non-null, `quantity = 1`,
and both `variantId` and `customizationConfigId` null; `lockedUnitPrice` non-null implies
`quoteItemId` non-null.
Indexes: `(cartId, position)`, partial unique `(cartId, variantId) where kind='STOCK'` so adding
the same variant twice increments rather than duplicates.

**Standard cart lines store no prices.** They are priced live from the catalogue at render and at
checkout, so a customer never pays a stale price and the cart cannot drift out of step with the
catalogue.

**Quote-bound cart lines store every price**, in `lockedUnitPrice`, including `FEE` lines. An
accepted quote is a commercial commitment and must reconcile to the exact figure the customer
accepted. `FEE` lines carry the quote's setup, digitising, rush and other charges through to the
order without folding them into a unit price, so the itemisation the customer agreed to survives
checkout intact.

---

## 8. Orders

### `orders`

| Column                                                                              | Type                             | Notes                                                                                                             |
| ----------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| id                                                                                  | uuid PK                          |                                                                                                                   |
| orderNumber                                                                         | text UNIQUE NOT NULL             | Sequence-backed, human-facing                                                                                     |
| userId                                                                              | uuid FK NULL                     | NULL for a guest order                                                                                            |
| guestToken                                                                          | text NULL UNIQUE                 | Grants access to the confirmation page only                                                                       |
| status                                                                              | OrderStatus NOT NULL             |                                                                                                                   |
| paymentStatus                                                                       | PaymentStatus NOT NULL           | Derived from payment rows                                                                                         |
| currency                                                                            | char(3) NOT NULL                 |                                                                                                                   |
| contactName / contactPhone                                                          | text NOT NULL                    | Snapshot. Phone is the primary operational contact                                                                |
| contactEmail                                                                        | text NOT NULL                    | Required on every order, guest included — it carries the confirmation and is the basis for later account claiming |
| subtotal                                                                            | integer NOT NULL                 | Sum of line totals                                                                                                |
| discountTotal                                                                       | integer NOT NULL default 0       | Positive number, subtracted                                                                                       |
| shippingTotal                                                                       | integer NOT NULL default 0       |                                                                                                                   |
| taxTotal                                                                            | integer NOT NULL default 0       | Zero in V1                                                                                                        |
| grandTotal                                                                          | integer NOT NULL                 |                                                                                                                   |
| amountPaid                                                                          | integer NOT NULL default 0       | Sum of succeeded payments                                                                                         |
| depositRequired                                                                     | integer NOT NULL default 0       | Computed at placement, snapshotted                                                                                |
| couponId                                                                            | uuid FK NULL                     |                                                                                                                   |
| couponCodeSnapshot                                                                  | text NULL                        | Survives coupon deletion                                                                                          |
| paymentMethod                                                                       | PaymentMethod NOT NULL           |                                                                                                                   |
| requestId                                                                           | uuid FK NULL                     | Originating custom request                                                                                        |
| quoteId                                                                             | uuid FK NULL                     | Accepted quote this order realises                                                                                |
| deliveryType                                                                        | DeliveryType NOT NULL            |                                                                                                                   |
| shippingRateId                                                                      | uuid FK NULL, ON DELETE SET NULL | Which rate applied. Reporting only                                                                                |
| shippingRateLabel                                                                   | text NULL                        | Snapshot, e.g. "Nord - Desk delivery". Set to "Quoted delivery" for a quote-derived order                         |
| carrierName / trackingNumber / trackingUrl                                          | text NULL                        |                                                                                                                   |
| estimatedDeliveryFrom / To                                                          | date NULL                        | Shown in the timeline                                                                                             |
| customerNote                                                                        | text NULL                        | Customer-written                                                                                                  |
| internalNotes                                                                       | text NULL                        | Never returned to a customer-scoped query                                                                         |
| cancellationReason                                                                  | text NULL                        |                                                                                                                   |
| placedAt                                                                            | timestamptz NOT NULL             |                                                                                                                   |
| archivedAt                                                                          | timestamptz NULL                 | Off the workshop's queues, and off nothing else (ADR-034)                                                         |
| confirmedAt / productionStartedAt / readyAt / shippedAt / deliveredAt / cancelledAt | timestamptz NULL                 | Denormalised from history for fast filtering                                                                      |
| createdAt / updatedAt                                                               |                                  |                                                                                                                   |

Checks: `grandTotal = subtotal - discountTotal + shippingTotal + taxTotal`;
`amountPaid >= 0`; `depositRequired <= grandTotal`.
Indexes: `(orderNumber) unique`, `(userId, placedAt desc)`, `(status, placedAt desc)`,
`(paymentStatus)`, `(placedAt desc)` for the admin queue, `(contactPhone)` for guest lookup,
`(quoteId) unique where quoteId is not null` — one order per accepted quote,
`(placedAt desc) where archivedAt is null` and `(archivedAt)`.

**`archivedAt`** (Phase 14.9) takes the row off the workshop's lists and does nothing else. It is
read by the admin's own list queries and by no customer-scoped query, so an archived record still
renders on the customer's screens, keeps every relation, and is one click from coming back. It is
**not** a soft delete and must never be confused with `deletedAt`: `deletedAt` means the record is
gone as far as the application is concerned, `archivedAt` means somebody tidied a queue. Four
tables carry it — `orders`, `custom_requests`, `quotes`, `reviews` — each with a partial index on
`WHERE archived_at IS NULL` for the live half and a plain index for the archived half. Products
archive through `products.status` instead and get no column. See ADR-034.


The order and line checks above are **implemented** in the Phase 8 migration, along with
`product_variants.reserved_quantity BETWEEN 0 AND stock_quantity`. The last one is what proves the
conditional reservation UPDATE was written correctly: an overselling bug would violate it rather
than quietly ship stock twice.

Totals are stored, not computed on read: an order is a financial record, and it must render
identically forever regardless of later catalogue, coupon or shipping changes. `shippingRateLabel`
extends the same guarantee to _why_ a delivery charge was what it was, which a rate table edited
six months later can no longer explain.

`depositRequired` is **copied from `quotes.depositRequired`** for a quote-derived order and is
never recomputed from the current deposit percentage. Only a non-quote custom order computes it
from the current rule. See `BUSINESS-RULES.md` section 5.5.

### `order_items`

| Column                | Type                             | Notes                                                                    |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| id                    | uuid PK                          |                                                                          |
| orderId               | uuid FK cascade                  |                                                                          |
| kind                  | LineKind                         | STOCK, CUSTOM or FEE                                                     |
| feeKind               | QuoteLineKind NULL               | Required when kind = FEE: SETUP_FEE, DIGITIZING, RUSH_FEE or OTHER       |
| productId / variantId | uuid FK NULL, ON DELETE SET NULL | References for reporting only                                            |
| customizationConfigId | uuid FK NULL                     | Frozen configuration                                                     |
| quoteItemId           | uuid FK NULL                     | The quote line this realises                                             |
| nameSnapshot          | text NOT NULL                    | For a FEE line this is the admin's quote label                           |
| variantLabelSnapshot  | text NULL                        | "Black / L"                                                              |
| skuSnapshot           | text NULL                        |                                                                          |
| imageKeySnapshot      | text NULL                        |                                                                          |
| unitPrice             | integer NOT NULL                 |                                                                          |
| quantity              | integer NOT NULL                 | Check > 0; always 1 for FEE                                              |
| lineDiscount          | integer NOT NULL default 0       |                                                                          |
| lineTotal             | integer NOT NULL                 | Check `= unitPrice * quantity - lineDiscount`                            |
| requiresProduction    | boolean NOT NULL                 | True for custom lines; drives the production queue. Always false for FEE |
| position              | integer                          |                                                                          |

Checks: `kind='STOCK'` implies `variantId` non-null; `kind='CUSTOM'` implies
`customizationConfigId` non-null; `kind='FEE'` implies `feeKind` non-null, `quantity = 1`,
`requiresProduction = false`, and `productId`, `variantId` and `customizationConfigId` all null.

Every snapshot column exists so a deleted product does not corrupt an order's display. This is
non-negotiable in commerce.

**Why `FEE` lines exist.** A quote's setup fee, digitising fee and rush fee are charged once per
job, not per unit, and have neither a product nor a customisation. Without a fee line kind they
would have to be folded into a unit price at acceptance, which would destroy the itemisation the
customer approved and leave the order unable to reconcile with the quote. `SHIPPING` and
`DISCOUNT` quote lines are _not_ order items — they map to `orders.shippingTotal` and
`orders.discountTotal` respectively, so the order-total invariant continues to hold. The full
mapping is in `BUSINESS-RULES.md` section 2.6.5.

### `order_addresses`

`id`, `orderId` FK cascade, `type` (`SHIPPING | BILLING`), `fullName`, `phone`, `wilayaCode`,
`wilayaNameSnapshot`, `communeName`, `addressLine`, `postalCode`, `notes`.
Unique `(orderId, type)`. A separate table rather than columns on `orders` because billing
addresses arrive with online payment providers, and the snapshot must be immutable.

### `order_status_history`

| Column            | Type                          | Notes                            |
| ----------------- | ----------------------------- | -------------------------------- |
| id                | uuid PK                       |                                  |
| orderId           | uuid FK cascade               |                                  |
| fromStatus        | OrderStatus NULL              | NULL on creation                 |
| toStatus          | OrderStatus NOT NULL          |                                  |
| actorType         | ActorType NOT NULL            |                                  |
| actorUserId       | uuid FK NULL                  |                                  |
| note              | text NULL                     |                                  |
| isCustomerVisible | boolean NOT NULL default true | Internal transitions stay hidden |
| createdAt         | timestamptz NOT NULL          |                                  |

Index `(orderId, createdAt)`. **Append-only.** No update, no delete. The `orders.status` column is
a materialised convenience; this table is the truth. Every write goes through the state machine.

### `payments`

`id`, `orderId` FK, `provider` text, `method` PaymentMethod, `kind` (`DEPOSIT | BALANCE | FULL |
REFUND`), `amount` integer, `currency`, `status` PaymentTxStatus, `providerReference` text NULL,
`idempotencyKey` text unique NULL, `rawPayload` jsonb NULL, `capturedAt`, `createdAt`,
`recordedByUserId` FK NULL (for a manually recorded cash payment).
Indexes: `(orderId, createdAt)`, `(providerReference)`, `(idempotencyKey) unique`.

`orders.paymentStatus` and `orders.amountPaid` are recomputed from these rows inside the same
transaction as any payment write. They are never set independently.

---

## 9. Custom Requests

### `custom_requests`

| Column                                                          | Type                     | Notes                                |
| --------------------------------------------------------------- | ------------------------ | ------------------------------------ |
| id                                                              | uuid PK                  |                                      |
| requestNumber                                                   | text UNIQUE              | Human-facing                         |
| userId                                                          | uuid FK NULL             | NULL only while DRAFT                |
| draftToken                                                      | text UNIQUE NULL         | Resume an anonymous draft            |
| status                                                          | RequestStatus NOT NULL   |                                      |
| source                                                          | RequestSource NOT NULL   |                                      |
| pricingMode                                                     | PricingMode NOT NULL     |                                      |
| contactName / contactPhone / contactEmail                       | text NULL                | Captured at submission               |
| preferredChannel                                                | NotificationChannel NULL | How the customer wants to be reached |
| estimateMin / estimateMax                                       | integer NULL             | Snapshot of what the builder showed  |
| customerNote                                                    | text NULL                |                                      |
| internalNotes                                                   | text NULL                | Admin-only                           |
| needsInfoReason                                                 | text NULL                | Shown to the customer in NEEDS_INFO  |
| assignedToUserId                                                | uuid FK NULL             |                                      |
| submittedAt / reviewedAt / quotedAt / respondedAt / convertedAt | timestamptz NULL         |                                      |
| expiresAt                                                       | timestamptz NULL         | Abandoned drafts are reaped          |
| archivedAt                                                      | timestamptz NULL         | Off the workshop's queue (ADR-034)   |
| convertedOrderId                                                | uuid FK NULL             |                                      |
| createdAt / updatedAt                                           |                          |                                      |

Indexes: `(requestNumber) unique`, `(userId, createdAt desc)`,
`(status, submittedAt asc) where status in ('SUBMITTED','IN_REVIEW','NEEDS_INFO')` — the admin
queue's covering index, oldest first, `(assignedToUserId)`,
`(createdAt desc) where archivedAt is null` and `(archivedAt)`.

### `custom_request_items`

`id`, `requestId` FK cascade, `customizationConfigId` FK, `quantity` (check > 0),
`estimateMin`/`estimateMax` integer NULL, `position`.
A request holds several configurations — "20 polos left chest and 5 caps front" is one request,
one quote, one order.

### `custom_request_events`

`id`, `requestId` FK cascade, `type` (`STATUS_CHANGE | MESSAGE | FILE_ADDED | QUOTE_SENT |
INTERNAL_NOTE`), `fromStatus`, `toStatus`, `actorType`, `actorUserId` FK NULL, `message` text,
`isCustomerVisible` boolean, `createdAt`.
Index `(requestId, createdAt)`. Append-only. Backs both the customer timeline and the
"ask a question" thread, so a negotiation stays inside the record instead of in email.

---

## 10. Quotes

### `quotes`

| Column                                                    | Type                       | Notes                                                                             |
| --------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------- |
| id                                                        | uuid PK                    |                                                                                   |
| quoteNumber                                               | text UNIQUE                | "Q-1042-v2"                                                                       |
| requestId                                                 | uuid FK NOT NULL           |                                                                                   |
| userId                                                    | uuid FK NOT NULL           | Denormalised owner, for direct scoping                                            |
| version                                                   | integer NOT NULL default 1 |                                                                                   |
| supersedesQuoteId                                         | uuid FK NULL               | Previous version                                                                  |
| status                                                    | QuoteStatus NOT NULL       |                                                                                   |
| currency                                                  | char(3) NOT NULL           |                                                                                   |
| subtotal                                                  | integer NOT NULL           | Sum of non-discount, non-shipping lines                                           |
| discountTotal                                             | integer NOT NULL default 0 |                                                                                   |
| shippingTotal                                             | integer NOT NULL default 0 |                                                                                   |
| taxTotal                                                  | integer NOT NULL default 0 |                                                                                   |
| grandTotal                                                | integer NOT NULL           |                                                                                   |
| depositRequired                                           | integer NOT NULL default 0 |                                                                                   |
| validUntil                                                | timestamptz NOT NULL       |                                                                                   |
| customerMessage                                           | text NULL                  | Visible to the customer                                                           |
| internalNotes                                             | text NULL                  | Never leaves the admin                                                            |
| rejectionReason                                           | text NULL                  |                                                                                   |
| createdByUserId                                           | uuid FK NOT NULL           | Which admin priced it                                                             |
| sentAt / viewedAt / respondedAt / acceptedAt / rejectedAt | timestamptz NULL           |                                                                                   |
| acceptanceValidUntil                                      | timestamptz NULL           | Set on acceptance to `acceptedAt + settings.custom_orders.acceptanceValidityDays` |
| createdAt / updatedAt                                     |                            |                                                                                   |

Checks: `grandTotal = subtotal - discountTotal + shippingTotal + taxTotal`;
`validUntil > createdAt`; `acceptanceValidUntil` non-null implies `acceptedAt` non-null.
Added in `20260906090000_admin_operations` (Phase 12):

- **`order_payment_proofs`** and the `payment_proof_status` enum — a customer's transfer receipt,
  attached to the **order** rather than to a payment, because 8.10.2 has it arrive before any
  payment exists. The design file is referenced with `ON DELETE RESTRICT`: evidence of payment must
  not vanish because a sweep tidied `design_files`.
- `order_payment_proofs_rejection_check` — a refusal states a reason.
- `order_payment_proofs_review_check` — anything reviewed carries a review time.
- `order_payment_proofs_one_pending_per_order` — a **partial unique index**, so "the proof" is an
  unambiguous phrase in the workspace that reviews it.
- `payments_amount_positive` — 8.8's arithmetic is over positive magnitudes; a refund is a
  `REFUND` row the domain subtracts, never a negative payment.
- `payments_order_status_idx` and the partial `orders_awaiting_payment_idx`, which are the two
  admin queues' indexes.

Added in `20260905220000_quote_sequence_and_invariants` (Phase 10):

- `quote_number_seq` and `next_quote_base()`, starting at 1000.
- `quotes_valid_until_check` — `valid_until > created_at`.
- `quotes_acceptance_check` — `acceptance_valid_until` implies `accepted_at`.
- `quotes_one_outstanding_per_request` — a **partial unique index** on
  `(request_id) WHERE status IN ('SENT','VIEWED')`, which is what makes 7.2's
  "at most one outstanding quote per request" a database fact rather than a
  convention.
- `quote_items_sign_check` — `unit_price < 0` only on a `DISCOUNT` line.
- `quote_items_fee_quantity_check` — a fee kind is quoted at quantity 1, because
  2.6.5 maps it to an order item that must be.
- `quotes_outstanding_validity_idx` and `quotes_acceptance_validity_idx`, the
  two expiry sweeps' indexes.
- `customization_configs_frozen_idx`, so "is this configuration frozen" is cheap
  on every write path.

Indexes: `(quoteNumber) unique`, `(requestId, version)` unique, `(userId, createdAt desc)`,
`(status, validUntil) where status in ('SENT','VIEWED')` for the send-expiry job,
`(acceptanceValidUntil) where status = 'ACCEPTED'` for the acceptance-expiry job,
`(createdAt desc) where archivedAt is null` and `(archivedAt)`.

`archivedAt` (Phase 14.9) hides the quote from the workshop's queue and from nothing else. See
ADR-034.

**A quote is immutable once sent.** Revision creates version N+1 and marks N `SUPERSEDED`.
Only one non-superseded, non-cancelled quote per request may be active at a time. See ADR-010.

**Sending a quote freezes what it prices.** Every `customization_config` reachable from the
quote's request items freezes at `SENT`, with its display snapshots written. A customer who needs
to change the configuration after that gets a clone and a new quote version, so version N remains
historically reproducible in full — its lines, its totals, and the configuration those lines
described. See ADR-010.

**Two independent expiries.** `validUntil` bounds how long an unanswered quote may be accepted.
`acceptanceValidUntil` bounds how long an _accepted_ quote remains checkout-valid, so an accepted
but unpaid quote cannot be redeemed at an obsolete price months later. See
`BUSINESS-RULES.md` section 7.10.

### `quote_items`

`id`, `quoteId` FK cascade, `requestItemId` FK NULL, `kind` QuoteLineKind, `label` NOT NULL,
`description` NULL, `quantity` integer NOT NULL default 1, `unitPrice` integer NOT NULL,
`lineTotal` integer NOT NULL (check `= unitPrice * quantity`), `position`.

`kind` gives the itemised structure the specification asks for — product, embroidery, setup fee,
delivery — and lets the domain layer sum lines correctly (`DISCOUNT` and `SHIPPING` lines are
excluded from `subtotal`). `unitPrice` may be negative only when `kind = 'DISCOUNT'`.

---

## 11. Reviews

### `reviews`

`id`, `productId` FK, `userId` FK, `orderItemId` FK NULL, `rating` smallint (check 1–5), `title`
NULL, `body` NOT NULL, `status` ReviewStatus default PENDING, `isVerifiedPurchase` boolean,
`adminResponse` text NULL, `moderatedByUserId` FK NULL, `moderatedAt`, `createdAt`, `updatedAt`.

Unique `(userId, productId)` where `deletedAt IS NULL` — one review per customer per product.
Indexes: `(productId, status, createdAt desc)`, `(status) where status='PENDING'`,
`(status, createdAt desc) where deletedAt IS NULL` (the moderation queue, filtered by state),
`(createdAt desc) where archivedAt is null` and `(archivedAt)`.

`deletedAt` and `archivedAt` are different things and the distinction matters here more than
anywhere: `deletedAt` means the customer withdrew the review and it must never be shown again;
`archivedAt` means a moderator took it off their queue. See ADR-034.

V1 permits reviews only from customers with a delivered order containing that product, so
`orderItemId` is non-null and `isVerifiedPurchase` is true. The nullable column exists for a later
policy change without a migration.

Because `userId` is NOT NULL, **a guest purchaser cannot review until they claim their order into
an account**. This is an accepted consequence of guest checkout, not an oversight; the reasoning
and the mitigation are in `BUSINESS-RULES.md` section 11A.4.

---

## 12. Discounts

Two independent mechanisms. Quantity tiers ship in **V1**; coupons in **V1.5**. Both express
percentages as integer basis points (`BUSINESS-RULES.md` section 1.6).

### `discount_tiers` _(V1)_

Quantity discount bands applied to the embroidery component of custom work. A table rather than a
settings value — see ADR-017.

| Column                | Type                          | Notes                                                       |
| --------------------- | ----------------------------- | ----------------------------------------------------------- |
| id                    | uuid PK                       |                                                              |
| minQuantity           | integer NOT NULL              | Inclusive lower bound. Check `>= 1`                          |
| maxQuantity           | integer NULL                  | Inclusive upper bound. NULL means open-ended (the top tier)  |
| discountBasisPoints   | integer NOT NULL              | 500 = 5%. Check between 0 and 10000                          |
| label                 | text NOT NULL                 | Shown on the quote and order line, e.g. "10–24 pieces"       |
| isActive              | boolean NOT NULL default true |                                                              |
| createdAt / updatedAt | timestamptz                   |                                                              |

Checks: `maxQuantity IS NULL OR maxQuantity >= minQuantity`; `discountBasisPoints` between 0 and
10000; `minQuantity >= 1`.
Indexes: `(minQuantity)`; partial unique `(minQuantity) where isActive`.

**Non-overlap is a service-layer invariant, asserted by test.** A Postgres exclusion constraint
over integer ranges could enforce it directly and that option stays open, but V1 validates the
whole active set on write: the admin edits tiers rarely and as a set, so validating the set is
simpler and produces a better error than a constraint violation on a single row.

Exactly one active tier must match any quantity `>= 1`, which is what lets tier selection be a
lookup rather than a search with a tie-break rule (`BUSINESS-RULES.md` section 2.5.1).

V1 seed:

| minQuantity | maxQuantity | discountBasisPoints | label             |
| ----------- | ----------- | ------------------- | ----------------- |
| 1           | 9           | 0                   | 1–9 pieces        |
| 10          | 24          | 500                 | 10–24 pieces      |
| 25          | 49          | 1000                | 25–49 pieces      |
| 50          | NULL        | 1500                | 50 pieces or more |

The 0% row exists deliberately rather than being implied by the absence of a tier: it makes "no
discount at this quantity" something the admin can see and edit, and it means a quantity with no
matching row is unambiguously a data defect rather than a silent zero.

### `coupons` _(V1.5)_

`id`, `code` citext unique, `description`, `type` CouponType, `value` integer (**basis points**
when `type = PERCENTAGE`, minor units when `type = FIXED_AMOUNT`; see `BUSINESS-RULES.md`
section 1.6), `minimumOrderTotal` integer NULL, `maximumDiscount` integer NULL,
`scope` CouponScope, `startsAt`, `endsAt` NULL, `usageLimitTotal` integer NULL,
`usageLimitPerCustomer` integer NULL, `usedCount` integer default 0,
`appliesToCustomOrders` boolean default false, `appliesToSaleItems` boolean default true,
`isActive`, `createdAt`, `updatedAt`.

### `coupon_restrictions`

`(couponId, targetType, targetId)` — targets a product, category or collection.

### `coupon_redemptions`

`id`, `couponId` FK, `orderId` FK unique, `userId` FK NULL, `amountDiscounted` integer,
`createdAt`. Unique `(couponId, orderId)`.
Per-customer limits are enforced by counting rows here, not by trusting `usedCount`, which is a
cached convenience. `usedCount` is incremented in the same transaction.

---

## 13. Content and Gallery

### `gallery_items`

`id`, `slug` unique, `title`, `description`, `imageKey` NOT NULL, `thumbnailKey`, `alt` NOT NULL,
`productType` text, `embroideryType` text, `position`, `isFeatured`, `isPublished`,
`sourceOrderId` FK NULL, `sourceDesignFileId` FK NULL, `customerConsentAt` timestamptz NULL,
`createdAt`, `updatedAt`, `deletedAt`.

**Enforced twice, in the domain and in the database** (Phase 13). `domain/gallery`'s
`mayPublishGalleryItem` refuses it with a sentence a person can act on, and
`gallery_items_consent_required` makes the row impossible:

```sql
CHECK (source_design_file_id IS NULL OR is_published = false OR customer_consent_at IS NOT NULL)
```

An item whose `sourceDesignFileId` is non-null cannot be published unless `customerConsentAt` is
non-null.
The gallery is the one place a private customer design could become public by accident, and it
is where a business-ending mistake would be made. The gallery image is always a **separately
uploaded public asset**, never a signed reference to the private original.

`gallery_tags`: `(galleryItemId, tagId)`. Shared tags are also what "related products" on a
gallery detail page joins on — a gallery item tagged `polo` leads to the polos a visitor can buy.

Index `(position, createdAt desc) where isPublished and deletedAt IS NULL` — the public listing's
order, partial so the published set stays small as the table grows.

### `homepage_sections`

`id`, `type` HomepageSectionType, `position`, `isEnabled`, `title`, `subtitle`, `body`,
`ctaLabel`, `ctaHref`, `imageKey`, `config` jsonb, `updatedAt`.
`config` is the one legitimate JSON column here: each section type has different, purely
presentational extras (how many products, which category IDs, an eyebrow label). Nothing in
`config` is ever queried or joined on.

In use since Phase 13: the homepage **is** these rows, ordered by `position` and switched by
`isEnabled`, so reordering the front page is an `UPDATE` rather than a deploy (ADR-027). `config`
is read through `domain/content`, which returns well-formed defaults for anything malformed —
a bad JSON edit costs a band some of its content, never the page.

**`MARQUEE` was added in Phase 16** — the twelfth type, and the only schema change the whole
redesign needed, which is the clearest evidence ADR-027 was the right call. Its `config.words` is
one string holding one phrase per line, split by `marqueeConfig` and capped at twelve phrases of
forty-eight characters. A string rather than a JSON array because the admin edits it in a textarea
and one-per-line is how anybody would write the list down. Nothing queries it, which is the test
`config` has to pass.

The same migration restored `customization_configs_design_surface_image_id_idx`, which had been
created by hand in `20260909210000_visual_placement` and never declared in `schema.prisma`. Every
migration generated after it wanted to drop the index, and in Phase 16 one of them did. **An index
created in hand-written migration SQL has to be declared in the Prisma schema as well**, or it is
live only until the next `migrate dev`.

### `banners`

`id`, `message`, `href` NULL, `variant`, `startsAt`, `endsAt` NULL, `isActive`, `position`.

### `faqs`

`id`, `question`, `answer`, `category`, `position`, `isPublished`.

### `pages`

`id`, `slug` unique, `title`, `body` (markdown), `seoTitle`, `seoDescription`, `isPublished`,
`updatedAt`. Backs About, Size Guide, Care Guide, Privacy, Terms — so the owner edits delivery
terms without a deployment.

### `social_links`

`id`, `platform`, `url`, `handle`, `position`, `isActive`.

---

## 14. Configuration and Operations

### `settings`

`key` text PK, `value` text NOT NULL, `type` SettingType, `group` text, `label`, `description`,
`isSecret` boolean default false, `updatedAt`, `updatedByUserId`.

A single typed key–value table. Groups: `brand`, `contact`, `shipping`, `payments`,
`custom_orders`, `notifications`, `seo`, `features`, `site`, `accounts`.

**Twelve of these keys are editable from `/admin/settings`; the rest are not**, and which is which
is decided by `EDITABLE_SETTINGS` in `domain/settings` rather than by anything in this table. A key
absent from that list cannot be written from a browser at all — `custom_orders.maxThreadColors` is
a safety limit the pricing code assumes is sane, not a preference. See ADR-037.

`updatedByUserId` is written by that screen, and only the rows whose value actually changed are
touched: "who changed the deposit percentage, and when" is the question the column exists to
answer.

Seeded keys, with their V1 values. This list is exhaustive for the `custom_orders` group, because
every value in it participates in a pricing or lifecycle rule and none of them may be hard-coded.

| Key                                            | Type   | V1 value | Rule                    |
| ---------------------------------------------- | ------ | -------- | ----------------------- |
| `brand.name`                                   | STRING | `Bizeora` | —                      |
| `brand.logoKey`                                | STRING | unset    | —                       |
| `contact.whatsapp`                             | STRING | —        | —                       |
| `shipping.defaultFreeThreshold`                | MONEY  | —        | Creation default only   |
| `custom_orders.depositPercent`                 | NUMBER | `5000`   | 5.5 — **basis points**, 50% |
| `custom_orders.quoteValidityDays`              | NUMBER | `14`     | 7.4                     |
| `custom_orders.acceptanceValidityDays`         | NUMBER | `7`      | 7.10                    |
| `custom_orders.responseTimeHours`              | NUMBER | `6`      | Shown to customers      |
| `custom_orders.quoteThresholdQuantity`         | NUMBER | `10`     | 2.3 condition 5         |
| `custom_orders.quoteThresholdThreadColors`     | NUMBER | `3`      | 2.3 condition 4         |
| `custom_orders.quoteThresholdInstructionLength`| NUMBER | `200`    | 2.3 condition 6         |
| `custom_orders.maxThreadColors`                | NUMBER | `8`      | 9.6 — selectable maximum |
| `custom_orders.estimateBandPercent`            | NUMBER | `1500`   | 2.4.2 — **basis points**, 15% |
| `custom_orders.threadColorSurchargePerColor`   | MONEY  | `150`    | 2.2 — per colour beyond the first, **placeholder** |
| `custom_orders.textSurcharge`                  | MONEY  | `250`    | 2.2 — per unit, when text is embroidered, **placeholder** |
| `custom_orders.setupFee`                       | MONEY  | `1200`   | 2.2 — once per configuration, **placeholder** |
| `custom_orders.setupFeeWaiverQuantity`         | NUMBER | `25`     | 2.2 — quantity at which the setup fee is waived, **placeholder** |
| `custom_orders.depositWindowDays`              | NUMBER | open     | 8.10.5 — owner decision |
| `notifications.adminRecipients`                | STRING | empty    | 11 — comma-separated; who the workshop is |
| `site.storefrontEnabled`                       | BOOLEAN| `true`   | 12.7 — off closes the public shop to everybody |
| `accounts.emailVerificationRequired`           | BOOLEAN| `true`   | 12.7 — off treats every signed-in customer as confirmed |
| `features.wishlist`                            | BOOLEAN| `false`  | V1.5 flag               |

The last four arrived in Phase 7. `BUSINESS-RULES.md` 2.2 always read them "from settings" but
this table had never named them, so the builder could not have priced a configuration without
either inventing a rate in code or adding them here. Their **values are placeholders** pending the
owner, in the same sense as the shipping rates — the shape and the units are right, the amounts are
a business decision.

Two distinct thread-colour limits exist and must not be conflated:
`quoteThresholdThreadColors` (3) is the point above which a configuration needs a human quote;
`maxThreadColors` (8) is the point above which it cannot be configured at all.

`notifications.adminRecipients` arrived in Phase 8A and is seeded **empty**, because a default
address would be somebody's real inbox written into a repository. Until it is filled in, the
`ADMIN_NOTIFICATION_EMAIL` environment variable is the bootstrap; with neither set, a staff
notification is written as a `SKIPPED` row rather than silently dropped.

**Percentage-valued settings are basis points**, never fractions — `depositPercent` is `5000`,
not `0.5`. See `BUSINESS-RULES.md` section 1.6 and ADR-018.

`site.storefrontEnabled` and `accounts.emailVerificationRequired` arrived in Phase 14.12 and both
**default to `true` when the row is absent**. A missing row means a database that has not been
seeded, not a decision, and defaulting the other way would close a working shop or switch a
security control off because somebody forgot to run the seed. The read that answers them
(`siteSettings()`) is memoised per request and never across requests — the pages where that would
matter are prerendered, and a cache between the row and the page is what makes a kill switch take
five minutes to arrive. See ADR-038.

`brand.logoKey` points at an image in the public bucket and lets the owner replace the logo
without a deployment. `config/brand.ts` retains a bundled asset used as the fallback whenever the
setting is unset — so the brand is replaceable both by an owner at runtime and by a developer at
build time.

**`shipping.defaultFreeThreshold` is a seeding and creation default only.** It is applied when a
shipping rate is created and is **never read during a live shipping calculation**. The sole
runtime source of truth for free delivery is `shipping_rates.freeOverAmount`, because a real shop
wants free delivery to Algiers and not to Tamanrasset, which one global number cannot express.
See `BUSINESS-RULES.md` section 4.2.

**Secrets are never stored here.** API keys live in environment variables. `isSecret` marks
values that are merely sensitive to display, such as a phone number.

### `shipping_zones` / `shipping_zone_wilayas` / `shipping_rates`

- `shipping_zones`: `id`, `name` ("Nord", "Hauts-Plateaux", "Sud"), `isActive`, `position`
- `shipping_zone_wilayas`: `(zoneId, wilayaCode)`, with `wilayaCode` **globally unique** so a
  wilaya can never resolve to two zones
- `shipping_rates`: `id`, `zoneId` FK, `deliveryType` DeliveryType, `price` integer,
  `freeOverAmount` integer NULL, `estimatedMinDays`, `estimatedMaxDays`, `isActive`.
  Unique `(zoneId, deliveryType)`

This mirrors how Algerian delivery is actually priced — by wilaya, differentiated by home versus
desk — while keeping the country out of the code. Another market is new rows, not a refactor.

**`price` and `freeOverAmount` are in the same unit as every other money column the application
displays: whole dinars.** The seed wrote them as centimes until Phase 14.6 (`60_000` meaning
600 DA), and because `components/commerce/price` renders the stored integer with zero fraction
digits, every checkout charged and displayed a hundredfold delivery fee — 60 000 DA of postage on a
6 400 DA order. The end-to-end journey in Phase 14.6 is what walked into it. Nothing in the pricing
code changed; the stored values did. This is the concrete form of the naming discrepancy ADR-012
carries, and it is why a money column's unit is worth stating beside the column rather than only in
an ADR.

### `notifications` — outbox

`id`, `userId` FK NULL, `channel` NotificationChannel, `template` text, `payload` jsonb,
`recipient` text, `dedupeKey` text NULL **unique**, `relatedOrderId` / `relatedQuoteId` /
`relatedRequestId` FK NULL, `status` NotificationStatus, `attempts` integer default 0,
`lastError` text NULL, `scheduledFor` timestamptz, `sentAt`, `readAt` timestamptz NULL (IN_APP),
`createdAt`.
Index `(status, scheduledFor) where status='PENDING'`, `(userId, createdAt desc)`,
unique `(dedupeKey)`.

Written in the same transaction as the state change it announces; delivered out of band. `payload`
is JSON because it is template variables, never queried.

`dedupeKey` is `<template>:<business identifier>` — an order number, a quote number — and for a
staff row the recipient address as well, so two configured addresses are two deliveries rather than
one row that half-succeeded. It is the idempotency key: the writer swallows the unique violation,
so announcing the same event twice is one row and one e-mail. Nullable because a row written before
Phase 8A has none, and because the constraint must not stop a future channel that has no natural
key.

`scheduledFor` does double duty. It is when a row becomes due, and while a dispatcher holds a row it
is the end of that dispatcher's five-minute lease — claiming is `UPDATE … WHERE id = ? AND
status = 'PENDING' AND scheduled_for <= now`, which is the same conditional update the order and
quote transitions use. A dispatcher that dies mid-batch therefore releases its rows when the lease
lapses, without a separate lock table.

The two credential templates are **not** stored here: `auth.verify_email` and `auth.password_reset`
are sent inline so that no live code or reset link is ever written to the database (ADR-026).

### `audit_logs`

`id`, `actorUserId` FK NULL, `actorType`, `action` text ("design_file.download",
"order.status_change", "customer.view"), `entityType`, `entityId`, `metadata` jsonb,
`ipAddress`, `userAgent`, `createdAt`.
Index `(entityType, entityId, createdAt desc)`, `(actorUserId, createdAt desc)`.

Every design-file access, every customer-PII view and every status change is recorded. This is the
only way to answer "who downloaded that logo" after the fact.

### `analytics_events` _(V1.5)_

`id`, `name`, `sessionId`, `userId` FK NULL, `properties` jsonb, `occurredAt`.
The taxonomy is defined in V1; persistence arrives in V1.5.

### `wishlist_items` _(V1.5)_

`(userId, productId)` composite PK, `variantId` FK NULL, `createdAt`.

---

## 15. Ownership Rules

Every table falls into exactly one class. This drives repository design.

| Class                       | Tables                                                                                                                                                                                                           | Access rule                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Public**                  | products, variants, images, categories, collections, tags, gallery (published), faqs, pages, banners, homepage sections, social links, wilayas, communes, placements, thread colours, embroidery sizes and fonts | Readable by anyone. Writable by ADMIN or STAFF only.                                                                        |
| **Customer-owned, direct**  | addresses, carts, custom_requests, quotes, orders, design_files, reviews, wishlist_items, notifications, sessions                                                                                                | Carries `userId`. Every customer-scoped query filters on it **in the query**.                                               |
| **Customer-owned, one hop** | cart_items, order_items, order_addresses, order_status_history, custom_request_items, custom_request_events, quote_items, customization_configs, customization_files, payments, coupon_redemptions               | Reached only through the owning parent, which was already ownership-scoped. Never queried by ID alone from a customer path. |
| **Admin-only**              | settings, audit_logs, coupons, shipping zones and rates, users (as a directory), internal note fields                                                                                                            | Requires STAFF or ADMIN.                                                                                                    |
| **System**                  | verification, notifications (dispatch), analytics_events                                                                                                                                                        | No direct user access.                                                                                                      |

### Field-level rules

- `internalNotes` on orders, requests and quotes is **never** included in a customer-scoped
  select. Enforced by the DTO mapper, not by remembering.
- `isCustomerVisible` on history and event tables filters the customer timeline.
- `design_files.storageKey` never leaves the server. Clients receive an opaque file ID and request
  a short-lived signed URL.
- Guest access to an order is granted only by `guestToken` (confirmation page) or by the
  order-number-plus-phone lookup, which is rate-limited and logged.

### Guest orders and the admin customer directory

There is **no separate `Customer` entity**. A guest order is an `orders` row with `userId` null
and `contactName`, `contactPhone` and `contactEmail` populated — email is required on every order,
so a confirmation can always be sent and the order can always be claimed later.

The admin customer directory is a **logical union**, computed at query time, not a table:

```
registered customers   users where role = 'CUSTOMER'
                       + their orders, joined on orders.userId
guest customers        distinct orders.contactPhone (normalised E.164)
                       where userId is null and that phone matches no user
                       + their orders, grouped by that phone
```

A guest who has ordered three times therefore appears once, with three orders. Every row is
labelled `Registered` or `Guest`, so the two remain distinguishable, and a guest row offers
"invite to create an account" rather than pretending to be a user.

Phone is the grouping key because it is the primary operational contact and the field most
reliably re-entered correctly; it is normalised to E.164 on write specifically so this grouping
works. Claiming an order into an account still requires a **verified email match**, because a
phone number typed at checkout is not proof of identity.

Introducing a real `Customer` entity would be the heavier alternative and is deliberately deferred
until a requirement demands it — merging guest history, storing per-customer terms, or segmentation
(V2). Doing so later is additive: a nullable `customerId` on `orders` and a backfill by phone.

---

## 16. Where JSON Is Used, and Why

Four places only. Everywhere else is relational.

| Table.column               | Reason                                                                   |
| -------------------------- | ------------------------------------------------------------------------ |
| `homepage_sections.config` | Presentational extras that differ per section type and are never queried |
| `notifications.payload`    | Template variables; write-once, read-once                                |
| `payments.rawPayload`      | The provider's response, kept verbatim for reconciliation and disputes   |
| `audit_logs.metadata`      | Arbitrary contextual detail; append-only, never joined                   |

Customisation, pricing, options, variants, addresses and **quantity discount tiers** are all
relational, because every one of them must be filtered, aggregated, constrained or reported on.
Discount tiers were explicitly considered for a JSON settings row and rejected on exactly this
rule — see ADR-017.

---

## 17. Index Summary

The indexes that carry real query load.

| Index                                              | Serves                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `products(status, publishedAt desc)`               | Shop listing                                                              |
| `products(categoryId, status)`                     | Category listing                                                          |
| GIN on product text                                | Search                                                                    |
| `product_variants(productId)`, `(sku) unique`      | Variant resolution, admin lookup                                          |
| `orders(userId, placedAt desc)`                    | Customer order list                                                       |
| `orders(status, placedAt desc)`                    | Admin order queue                                                         |
| `orders(contactPhone)`                             | Guest order lookup, and grouping the guest half of the customer directory |
| `custom_requests(status, submittedAt asc)` partial | The admin's primary queue                                                 |
| `quotes(status, validUntil)` partial               | The send-expiry cron job                                                  |
| `quotes(acceptanceValidUntil)` partial             | The acceptance-expiry cron job                                            |
| `carts(quoteValidUntil)` partial                   | Invalidating stale quote-bound carts                                      |
| `product_image_placement_anchors(productImageId)`  | Preview overlay rendering                                                 |
| `order_status_history(orderId, createdAt)`         | Timeline rendering                                                        |
| `cart_items(cartId)`                               | Cart rendering                                                            |
| `reviews(productId, status, createdAt desc)`       | Product page reviews                                                      |
| `design_files(ownerUserId, createdAt desc)`        | Design library                                                            |
| `notifications(status, scheduledFor)` partial      | Outbox dispatch                                                           |
| `notifications(dedupeKey)` unique                  | One e-mail per event, however many times it is announced                  |
| `audit_logs(entityType, entityId, createdAt desc)` | Investigations                                                            |

Partial indexes are used wherever a query only ever touches a subset (pending reviews, active
carts, unsent notifications), because they stay small as the table grows.

---

## 18. Constraints Worth Restating

### 18.1 Database constraints

Integrity that lives in PostgreSQL, not only in application code. Every item here is a real
`CHECK` constraint or index in `prisma/sql/constraints.sql`:

1. `orders.grandTotal = subtotal - discountTotal + shippingTotal + taxTotal`
2. `order_items.lineTotal = unitPrice * quantity - lineDiscount`
3. `quotes.grandTotal = subtotal - discountTotal + shippingTotal + taxTotal`
4. `product_variants.stockQuantity >= 0` and `reservedQuantity >= 0`
5. `reviews.rating` between 1 and 5
6. One active standard cart per user (partial unique on `userId where kind='STANDARD' and
   status='ACTIVE'`)
7. One cart per quote (partial unique on `carts.quoteId`)
8. One default address per user (partial unique)
9. One order per accepted quote (partial unique on `orders.quoteId`)
10. One review per customer per product (partial unique)
11. A wilaya belongs to exactly one shipping zone (global unique on `wilayaCode`)
12. A line is STOCK with a variant, CUSTOM with a configuration, or FEE with a name, a quantity of
    1 and no references (check constraint on both `cart_items` and `order_items`)
13. A customisation names either a product or a free-text type (check constraint)
14. One placement anchor per image per placement (unique on `(productImageId, placementId)`)
15. A frozen customisation has its display snapshots populated (check constraint)
16. `discount_tiers.discountBasisPoints` between 0 and 10000, `minQuantity >= 1`, and
    `maxQuantity IS NULL OR maxQuantity >= minQuantity` (check constraints)

### 18.2 Service and domain invariants

Rules that are just as binding but that a `CHECK` constraint cannot express, because a `CHECK`
sees one row and cannot aggregate over another table. They are enforced in `domain/` and asserted
by test, never by a trigger — pricing arithmetic does not belong in SQL, where it would be a
second implementation of a rule that `BUSINESS-RULES.md` section 16 requires to exist exactly once.

1. **`orders.subtotal = SUM(order_items.lineTotal)`** — including `FEE` lines, which is why
   `SHIPPING` and `DISCOUNT` quote lines must map to the order's totals rather than to line items.
   Rule and mapping: `BUSINESS-RULES.md` section 2.6.5. Enforced at order placement, where the
   reconstructed total must equal `quote.grandTotal` exactly: `BUSINESS-RULES.md` section 5A.6.
   The same shape applies to `quotes.subtotal` over `quote_items`.
2. **Active discount tiers do not overlap and cover every quantity `>= 1`** — validated over the
   active set on write (section 12). A Postgres exclusion constraint is recorded as a future
   option.

Foreign key delete behaviour: `CASCADE` for owned children (order items, history, cart items);
`RESTRICT` for references that must not silently vanish (a category with products);
`SET NULL` for references kept only for reporting (an order item's product after archival), which
is exactly why order items snapshot their display data.

---

## 19. Seed Data

The Database phase must seed: 58 wilayas with French and Arabic names; the three shipping zones
with home and desk rates; placements with diagram assets; embroidery sizes; a thread-colour
palette; embroidery fonts; a default customisation profile; the settings table; an admin user; and
the four `discount_tiers` rows listed in section 12; and a realistic demo catalogue of roughly 20
products with variants, images, categories, placement anchors on every primary image, and a
handful of approved reviews. Demo content is realistic embroidery-business content, never lorem
ipsum.

The admin user is the one seed item that is not plain content: it is a real credential, so it is
provisioned through Better Auth rather than written by hand, which is what puts the Argon2id hash
on its credential account row (section 4). The seed creates no other users, sessions, accounts or
verification rows, and no password values at all.

Seeded settings values are those in the section 14 table. Percentage settings are seeded as basis
points; a seed writing `0.5` for `depositPercent` is a defect, not a rounding difference.

**`prisma/demo-seed.sql` is the same data as SQL, plus the administrator the seed deliberately
omits.** It exists for a machine that has a database but no Node — a laptop running a build for a
client, most often — and it is a `pg_dump` of a freshly migrated and seeded database rather than a
hand-written script, so it cannot drift from the schema without the dump being regenerated. It
needs the migrations applied first, a superuser (it disables foreign-key triggers while it loads,
because the tables reference each other in both directions), and an otherwise empty database. Every
statement ends in `ON CONFLICT DO NOTHING`, so running it twice changes nothing the second time.

The administrator it creates — `admin@gmail.com`, password `admin@gmail.com`, in
`prisma/demo-admin.sql` on its own — is **a demonstration credential and a back door**. The
password is in the repository; the account has to be deleted before the site is reachable from
anywhere but the machine it was made for. It is the exception that proves the paragraph above, not
a change to it: `prisma/seed.ts` still creates no user at all.
