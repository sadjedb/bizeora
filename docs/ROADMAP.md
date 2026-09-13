# ROADMAP.md

> The implementation plan. Scope definitions are in `PRODUCT.md` sections 11 and 12.
> The current task is always in `tasks/CURRENT.md`.

---

## 1. Release Scope

### V1 — the core commercial product

Everything needed to run the business online. A customer can buy a stock item or order custom
embroidery end to end; the owner can operate the entire business from the admin.

| Area            | Included                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation      | Next.js, TypeScript, Tailwind, design tokens, layer boundaries, CI                                                                                   |
| Database        | Full schema per `DATABASE.md`, migrations, seed data                                                                                                 |
| Auth            | Register, log in, verify email, reset password, roles, sessions                                                                                      |
| Design system   | Tokens, primitives, product cards, tables, dialogs, forms, states                                                                                    |
| Storefront      | Home, shop, product, category, gallery, how it works, about, FAQ, contact, size guide, care guide, legal                                             |
| Catalogue       | Products, options and variants, images, categories, tags, stock, search, filters                                                                     |
| Cart            | Guest and authenticated standard cart, plus quote-bound carts, server-computed totals                                                                |
| Checkout        | Algerian address model, wilaya shipping, required email, COD, offline deposit flow, order placement                                                  |
| Custom builder  | Five steps, private uploads, visual placements, live estimate, drafts, raster preview from the placement step, add-another-product                   |
| Quotes          | Full lifecycle, itemised lines, versioning, freeze on send, send expiry and acceptance validity, accept and reject, message thread                   |
| Notifications   | Transactional email, customer and admin directed, through the outbox and dispatcher                                                                  |
| Customer portal | Overview, orders, requests, quotes, addresses, profile, order timeline                                                                               |
| Admin           | Dashboard with recent customers, request queue, quote builder, orders, products, categories, customer directory, reviews, gallery, content, settings |
| Reviews         | Verified-purchase reviews with moderation                                                                                                            |
| SEO             | Metadata, structured data, sitemap, robots, canonicals, redirects                                                                                    |
| Security        | Everything in `SECURITY.md`                                                                                                                          |
| Quality         | Domain unit tests, critical-path E2E, accessibility, performance budgets                                                                             |

### V1.5 — retention and merchandising

Added once V1 is live and stable, in this order. **Transactional email is not on this list — it
ships in V1** (see Phase 8A); what remains here is everything beyond it.

1. **WhatsApp notifications** — templated delivery on the existing outbox; the largest remaining
   operational gain in this market
2. **Reorder** — the retention mechanism for the highest-value segment
3. **Saved design library** — makes reorder genuinely one-click
4. **Coupons** — the first real marketing lever
5. **Collections** — merchandising beyond categories
6. **Wishlist**
7. **Advanced stock** — low-stock alerts, backorder, stock history
8. **Analytics persistence** — the taxonomy already exists
9. **Two-factor authentication for staff**
10. **Size-breakdown control** in the builder
11. **Customer notification preferences** and dispatcher tuning
12. **Product bundles**

### V2 — automation and scale

Automated embroidery pricing from artwork analysis · Photorealistic mockup generation ·
WhatsApp Business API automation · Abandoned-cart recovery · Analytics dashboards ·
Customer segmentation · Online payment providers · Carrier API integration (Yalidine, ZR Express) ·
Production board and machine scheduling · Arabic locale · Multi-currency · Malware scanning

### Scope discipline

**No V1.5 or V2 feature is implemented during V1**, including "while I am already in this file".
Where V1 must not foreclose a later capability, the constraint is recorded in `ARCHITECTURE.md`
section 16 and satisfied by an interface or a nullable column — never by building the feature.

Feature flags in the settings table gate anything shipped dark.

---

## 2. Implementation Phases

Nineteen phases — eighteen numbered, plus Phase 8A. Each has an entry condition, a scope, and a
definition of done. A phase is not started until the previous one's definition of done is met.

---

### Phase 1 — Foundation

**Goal**: a repository that builds, lints, type-checks and deploys, with the layer boundaries
enforced from the first commit.

- `git init`, rename the project root from `your-project`, `.gitignore`, licence
- Next.js with the App Router, TypeScript strict, `noUncheckedIndexedAccess`
- Tailwind wired to CSS custom properties; `styles/tokens.css`; `config/brand.ts`
- Directory skeleton per `ARCHITECTURE.md` section 17
- `lib/env.ts` with schema-validated environment variables
- ESLint with the import-boundary rule (`domain/` imports nothing upward; only repositories import
  Prisma; components never import services), Prettier
- Vitest and Playwright configured with one smoke test each
- GitHub Actions: type-check, lint, unit tests, build
- Deployment to the hosting platform with a preview environment
- **Database connection pooling strategy** decided and configured for the deployment target before
  any query exists — a pooled connection string for the serverless runtime, a direct connection for
  migrations, and the Prisma client configured for both. Discovering this under load in Phase 8 is
  the classic failure mode
- **Pin `sharp` and verify it builds and runs on the target platform**, including the correct
  platform binaries in CI and in the deployed runtime. It is needed for product imagery and blur
  placeholders; the preview path deliberately does not depend on it (ADR-011)
- `CLAUDE.md` completed

**Done when**: CI is green on an empty application, the boundary lint rule fails on a deliberate
violation, a preview deployment is reachable, a pooled database connection is proven from the
deployed runtime, and `sharp` processes a test image on the deployed platform.

---

### Phase 2 — Database

**Goal**: the schema from `DATABASE.md` exists, is migrated, and is seeded with real reference data.

- Prisma schema for every entity, enum, index and constraint in `DATABASE.md`
- Check constraints that Prisma cannot express, added by raw SQL migration
- Initial migration; migration workflow documented
- Seed: 58 wilayas (French and Arabic), shipping zones and rates, placements with diagrams,
  embroidery sizes, thread colours, fonts, the default customisation profile, settings, an admin
  user, and roughly 20 demo products with variants, images, categories, **placement anchors on
  every primary image**, and reviews
- Confirm the corrections locked before this phase are present in the schema: `FEE` in `LineKind`,
  `CartKind`, the customisation display snapshots and `frozenAt`,
  `product_image_placement_anchors`, `orders.shippingRateId` and `shippingRateLabel`,
  `orders.contactEmail` NOT NULL, and `quotes.acceptanceValidUntil`
- Prisma client singleton; connection pooling configured for serverless
- Repository layer scaffolded with actor types

**Done when**: `migrate reset` plus `seed` produces a working database from scratch, every
constraint in `DATABASE.md` section 18 is present, and no application code outside
`server/repositories/` imports Prisma.

---

### Phase 3 — Authentication

**Goal**: identity, roles and sessions, with authorisation wrappers ready for every later phase.

- Better Auth with database sessions, Argon2id
- Register, log in, log out, verify email, request and perform password reset
- Role model and seeded admin
- `publicAction`, `customerAction`, `adminAction` wrappers with validation, rate limiting and
  error normalisation
- Actor types; ownership-scoped repository helpers
- Middleware for coarse route protection
- Rate-limit adapter with the Upstash implementation and the Postgres fallback
- Auth pages using early design-system primitives

**Done when**: a customer and an admin can each complete the full auth lifecycle, an admin route
is unreachable with a customer session at both the layout and action layers, and the wrapper
suite has integration tests.

---

### Phase 4 — Design System

**Goal**: every primitive the rest of the build consumes, documented on a working page.

- Tokens: colour, typography, spacing, radius, shadow, motion — as CSS variables
- Fonts self-hosted, subset, preloaded
- shadcn/ui primitives installed and restyled to the tokens
- Components: button, input, textarea, select, checkbox, radio, switch, chip, swatch, quantity
  stepper, badge, status indicator, card, dialog, sheet, drawer, dropdown, tabs, accordion,
  toast, tooltip, table, pagination, breadcrumb
- Shared state components: skeletons, empty state, error state, price, money formatter
- Layout shell: header, mobile drawer, footer, container, section
- An internal `/dev/design-system` page rendering every component in every state
- Reduced-motion and focus behaviour verified across the set

**Done when**: the design-system page renders every component in default, hover, focus, disabled,
loading and error states; a keyboard pass reaches everything; and no component contains a literal
colour or font.

---

### Phase 5 — Storefront Shell and Content

**Goal**: the public marketing surface, database-driven.

- Homepage with admin-managed sections
- How It Works, About, FAQ, Contact, Size Guide, Care Guide, Privacy, Terms from the `pages`
  and `faqs` tables
- Gallery listing and detail with filtering
- Header, footer, navigation, mobile drawer, search overlay shell
- Contact form with rate limiting and validation
- Floating WhatsApp CTA, settings-driven
- Static generation with tag-based revalidation
- 404 and error boundaries

**Done when**: every listed page renders from the database, is responsive at all seven test
widths, meets the LCP budget on a throttled mobile connection, and none contains lorem ipsum.

---

### Phase 6 — Product System

**Goal**: the catalogue, on both the storefront and the admin.

- Product listing with search, category filter, option filters, sorting, pagination
- Category pages with SEO metadata
- Product detail: gallery, variant selector with availability, stock status, details, related
  products, reviews placeholder
- Admin product CRUD, image upload to the public bucket, option and variant generation, stock
  editing, publish and unpublish
- **Placement anchor capture** on product images, with sensible per-placement defaults so this is
  an adjustment rather than a data-entry task. The builder's preview in Phase 9 depends on it
- Admin category CRUD with reordering
- Product-slug redirects
- Domain: `pricing/` unit price resolution, availability

**Done when**: an admin can create a product with two options and generated variants and see it
live; unavailable combinations are disabled at selection; the listing renders in six queries or
fewer; and the pricing unit tests pass.

---

### Phase 7 — Cart

**Goal**: a cart that holds stock lines and is priced only by the server.

- Guest cart via an `HttpOnly` token cookie; user cart; merge on login
- Add, update quantity, remove; cart page and slide-over
- **`CartKind` support**: the standard cart is fully built here; the quote-bound cart's structure,
  constraints and read path are built here and populated in Phase 10
- Domain: `cart/` totals, `shipping/` resolution, wilaya-based delivery estimate in the cart
- Availability checks with clear messaging
- Free-shipping threshold progress, read from `shipping_rates.freeOverAmount` only
- Empty, loading and error states
- Domain unit tests for totals

**Done when**: totals are computed only in `domain/cart`, a guest cart survives a login merge, a
tampered client total has no effect, a quote-bound cart rejects additions, quantity edits and
coupons, and the totals tests cover every boundary.

---

### Phase 8 — Checkout and Orders

**Goal**: money changes hands and an order exists.

- Checkout: contact (name, phone, **email required**), delivery (wilaya, commune, home or desk),
  payment, notes
- Guest and authenticated paths
- Payment provider registry with COD and bank transfer; `supports()` expresses the rule that a
  custom order is not COD-eligible
- Order placement in one transaction: revalidate, recompute, reserve stock, snapshot totals and
  `shippingRateId`/`shippingRateLabel`, create order, items, address, history and notification rows
- **`FEE` order items** and the quote-line mapping (`BUSINESS-RULES.md` 2.6.5), with the
  reconciliation assertion
- **Offline deposit flow**: payment reference, proof-of-payment upload, admin confirm or reject,
  derived payment status, `AWAITING_PAYMENT` semantics
- Order number generation
- Confirmation page with a single-use guest token, and post-purchase account claiming
- Guest order tracking by order number plus phone, rate-limited
- Admin order list and workspace: status transitions, tracking, internal notes, payments
- Domain: `order/` totals, deposits, state machine
- Customer order list and detail with the status timeline
- Mixed-cart delivery estimate messaging (single fulfilment unit, `BUSINESS-RULES.md` 8.9)

**Done when**: both purchase paths complete end to end; concurrent orders cannot oversell a
variant; every transition is written to history; a tampered price is rejected; a deposit can be
recorded and confirmed by an admin; and the state machine's rejection tests cover the full
transition cross product.

---

### Phase 8A — Transactional Notifications — **done**

**Goal**: nobody is left in silence. Small, and a hard prerequisite for the quote flow.

Delivered, with three items deliberately deferred and recorded in `tasks/CURRENT.md`: the
WhatsApp click-to-chat generator, in-app notification records, and the `acceptanceValidUntil`
warning.

- Outbox dispatcher behind `POST /api/jobs/notifications`, with retry, backoff and idempotency.
  Every five minutes rather than every minute: the warning window is two days wide and a
  confirmation arriving within five minutes reads as immediate
- Email channel (Resend) behind the transport interface, chosen by configuration rather than by
  `NODE_ENV` — memory under test, console when no key is set, so a test run sends nothing
- Customer templates: `auth.verify_email`, `auth.password_reset`, `order.confirmed`, `quote.sent`,
  `quote.expiring`
- **Admin templates**: `order.placed`, `request.submitted`, `quote.expiring.staff`
- Staff recipient resolution from the `notifications` settings group, with an environment
  bootstrap and a visible `SKIPPED` row when neither is configured
- Audience typing, so a customer template cannot be dispatched to a staff recipient
- The two credential e-mails deliberately bypass the outbox (ADR-026)

**Done when**: placing an order sends a confirmation, a password reset arrives, an admin is
notified of a new order, a provider outage queues rather than loses messages, and a duplicate
dispatch cannot send twice. **All met.**

_Phase 3 already depends on email for verification and reset. This phase turns that dependency
into a real, monitored delivery path rather than a one-off call._

---

### Phase 9 — Custom Builder

**Goal**: the product's centrepiece.

- Five-step configurator with URL-addressable steps
- Product step from the database; placement step with diagrams; upload step; options step;
  review step
- Upload pipeline: presign, direct PUT, completion validation, magic-byte checking, SVG
  sanitisation, raster thumbnail generation (PNG/JPG only), quarantine promotion
- Draft persistence: local storage, then server-side once identified; resumable links
- Live estimate at every step, with the quote-mode range and reason
- **Static design-on-product preview**, PNG and JPG only, driven by
  `product_image_placement_anchors`, live from the placement step onward; explicit
  "preview unavailable for this file type" treatment for SVG and PDF
- **"Add another product to this request"** on the review step, producing multiple request items
- Hybrid entry from a product page
- Domain: `customization/` validation, `pricing/` surcharges, `request/` pricing-mode determination
- Fixed-price path adds a custom line to the cart

**Done when**: a custom order can be configured and added to the cart on a phone in under three
minutes; a forged upload (wrong magic number, oversized, script-bearing SVG) is rejected; a draft
survives a refresh and a device change; and pricing-mode determination is unit tested against
every condition.

---

### Phase 10 — Quotes — **done**

**Goal**: the quote-mode half of the custom flow, both sides.

Delivered, with four items deliberately deferred and recorded in `tasks/CURRENT.md`: quote
line templates, the scheduled expiry cron and the admin
notifications (both delivered by Phase 8A), and "request an updated quote" as a clone of the
frozen configuration.

- Request submission with account creation at the point of submission
- Admin request queue with age indicators and needs-attention pinning
- Admin request workspace: file viewer, configuration, customer history, internal notes
- Quote builder with line templates, automatic quantity-discount lines, and a customer preview
- Send, revise (versioning and supersession), cancel
- **Freeze on send**: configurations frozen and display snapshots written in the send transaction;
  edits after send produce a clone and a new quote version
- Customer quote view: itemised lines, expiry countdown, accept, reject, ask a question
- Acceptance transaction: quote, request, **quote-bound cart**, `acceptanceValidUntil`, events
- **Quote-bound checkout**: exclusive cart, quoted shipping, no coupons, exact reconciliation
- Expiry: hourly cron for both send expiry and acceptance validity, plus lazy checks on read
- `NEEDS_INFO` handling including from `QUOTED`, distinct from the message thread
- Message thread on the request (`MESSAGE` events, no status effect)
- Admin notifications wired: `request.submitted`, `quote.expiring`
- Domain: `quote/` totals, state machine, line mapping and acceptance validity;
  `request/` state machine; `customization/` freeze and clone

**Done when**: the full journey from submission to a converted order works; a sent quote cannot be
mutated and neither can the configuration it prices; a quote containing every line kind produces an
order whose total equals the quote's exactly; an accepted quote can back exactly one order; an
accepted quote lapses after its validity window and offers an updated quote; and both state
machines have exhaustive rejection tests.

---

### Phase 11 — Customer Portal — **done**

**Goal**: the account area completed.

Delivered, with three items deliberately deferred and recorded in `tasks/CURRENT.md`: the address
book, editing a profile or password, and post-purchase account creation with guest-order claiming.
The IDOR suite that this phase's definition of done requires is
`tests/integration/account.test.ts` plus journey E in `tests/e2e/account.spec.ts`.

- Overview triage screen ordered by what is blocked
- Orders, requests, quotes lists and details
- Address book with a default address
- Profile and password management
- Empty states throughout
- Post-purchase account creation and guest-order claiming

**Done when**: every account route is ownership-scoped in the query, the IDOR test suite passes
for every resource, and every list has a designed empty state.

---

### Phase 12 — Admin Completion — **operations delivered**

**Goal**: the owner can run the business without touching the database.

The **operational half** shipped: the dashboard of actionable queues, the request workspace with
its status filter, the quotes queue, the order list and workspace with the full section 8 state
machine, the manual payment and deposit-proof flow of 8.10, shipping and tracking, internal notes,
and the registered-customer directory. A simulated business day — request, quote, acceptance,
order, production, shipment, payment — runs entirely through the UI, and is an end-to-end test.

**Still outstanding, and deliberately so**: the guest half of the customer directory
(phone-grouped contacts), gallery curation, content management, placement anchor editing, the
settings screens, the audit-log viewer, admin dark mode, and admin catalogue management, which is
Phase 6's own unfinished half. Review moderation was delivered by Phase 13, which owns the
customer-facing half of the same feature. Nothing in the list below was quietly dropped;
`tasks/CURRENT.md` names each one.

- Today dashboard with actionable rows only, plus **Recent Customers**
- **Customer directory as a union** of registered users and phone-grouped guest contacts, each row
  labelled, with detail views and audit-logged PII access
- Review moderation with denormalised rating recomputation
- Gallery curation with the consent constraint
- Content management: homepage sections, banners, FAQs, pages, social links
- **Placement anchor editing** on product images (Phase 6 captures them; refinement lives here)
- Settings: brand (including **`brand.logoKey`** upload, with the bundled asset as fallback),
  contact, shipping zones and rates, custom-order parameters (deposit percent, quote validity,
  acceptance validity, response time, thresholds), payment methods, notification recipients,
  feature flags
- Audit log viewer
- Admin dark mode
- Mobile-workable dashboard, queue and status changes

**Done when**: a full simulated business day — new request, quote, acceptance, order, production,
shipment, review moderation, a content edit — is completed entirely through the UI.

---

### Phase 13 — Reviews, Gallery, Content Polish — **done**

**Goal**: trust surfaces finished.

Delivered. Three things are deliberately outside it and stay in Phase 12's outstanding half:
**gallery curation, content management and settings screens** — the rows are read by the storefront
and edited in the database until that half is built.

- Review submission restricted to delivered purchases, moderated before it is public, with the
  denormalised rating recomputed in the moderation transaction
- Review display on product pages with the rating distribution
- Gallery filtering (by link, so a filtered view is a URL), detail pages, and links to related
  products through shared tags
- Trust elements: why-us and quality guarantee from the content rows, **delivery information from
  `shipping_rates`** rather than typed-in copy, and a social band
- Homepage section types all implemented and reorderable — the page is
  `homepage_sections` (ADR-027). `CATEGORY_GRID` ships disabled because its cards lead to
  `/shop/c/[category]`, which Phase 6 has not built

**Done when**: a customer with a delivered order can review it, moderation controls visibility,
and the denormalised rating is correct after every moderation action. **All met.**

---

### Phase 14 — SEO — **done**

**Goal**: the storefront is properly indexable. Work done throughout, verified here.

Delivered, with three items recorded as outstanding in `tasks/CURRENT.md` rather than dropped:
**410 for archived products** (the App Router cannot set a status from a page; it needs middleware
or a route handler, and Prisma does not run at the edge), **FAQPage** (there is no `/faq` route —
it is one of the storefront routes no phase owns), and **category URLs** (there is no
`/shop/c/[category]` route to list; Phase 6's own unfinished half).

- Static and dynamic metadata on every public route, built by one helper so a canonical cannot
  disagree with its `og:url`
- Open Graph and Twitter cards, with a **generated** social card for products and a site-wide one,
  because there is no photography yet and a card is worth more than a bare link
- JSON-LD: Organization, WebSite, BreadcrumbList, Product with offers and — only when there are
  approved reviews — an aggregate rating, and ItemList on both listings
- `sitemap.xml` from the repositories, behind the storefront's own visibility predicates;
  `robots.txt` with every application surface excluded
- Canonical URLs, absolute and from the configured origin; filtered gallery views canonicalise to
  `/gallery` and carry `noindex, follow`
- 301 redirects from `product_redirects` (as a 308, which search engines treat identically)
- A **deployment-wide indexing switch** (`SEO_INDEXABLE`, ADR-028), off unless set, which Phase 18
  turns on at launch

**Done when**: structured data validates without error, the sitemap contains every public URL and
no private one, and Lighthouse SEO is at least 95 on home, shop, product and gallery. The first two
are met and asserted by tests. **Lighthouse cannot score a deployment that asks not to be indexed**,
so the score is a launch-time check with `SEO_INDEXABLE` set — recorded in Phase 18 rather than
claimed here.

---

### Phase 14.5 — Redesign and Admin Operations — **done**

Inserted after Phase 14. The application worked; it did not look or operate like a product somebody
would trust with a commission, and the workshop still could not add the thing it sells.

**Goal**: a coherent new visual direction across both applications, and the two missing admin
capabilities.

**Delivered**

- **A revised visual direction.** The neutral ramp cooled, the accent moved from ochre to madder,
  the radii flattened, and three surface roles and a hairline border weight were added — including
  `bg-sunken`, which eight components had already been referencing without it existing.
  `DESIGN-SYSTEM.md` sections 1, 4, 7, 12 and 15 describe what is now built.
- **A full-viewport homepage hero**, and an inverse closing band, inside the existing
  `homepage_sections` architecture (ADR-027). No second homepage architecture.
- **A table-first admin.** Dashboard, orders, requests, quotes, customers, payments, products and
  stock are real `<table>`s that fold into labelled blocks below `md`.
- **A persistent sidebar**, grouped, with a real drawer on mobile.
- **Product management** — the capability recorded as missing since Phase 6: create, edit, rename
  (writing the `product_redirects` row 11.6 has always specified), publish, archive, plus options,
  values and variants with SKUs and price overrides.
- **Stock management** — a new screen and a new table. Signed deltas, closed reason set, an
  append-only ledger, and two invariants enforced by the `UPDATE` itself (ADR-029, 10.10).
- **A payments queue**, aggregating what Phase 12 built inside individual order workspaces.

**Deliberately not built**: product image upload, because the public asset bucket Phase 9 was to
provision does not exist and `lib/storage` knows only private prefixes; category management; and
everything in Phase 12's outstanding half that this phase did not need.

**Done when**: the admin can create and stock a product without a database client, no business or
security boundary moved, and the full suite, the production build, a clean-database replay, axe and
the 375/768/1024/1440 sweep all pass. Met.

---

### Phase 14.6 — Cleanup, payment screen, end-to-end validation — **done**

A short validation phase between the redesign and the security work. No feature development.

**Delivered**

- **The development database was cleaned.** 40 E2E fixture accounts and the records their
  teardowns had orphaned — 179 orders, 88 requests, 645 carts, 315 design files, 131
  notifications — removed, along with 6 169 orphaned storage objects. Reference and seed data
  untouched; the four hand-made developer accounts and everything they own preserved.
- **`/admin/payments` was fixed.** It opened on a facet that is empty in an ordinary shop and
  filtered "deposit due" on an order status rather than on the money, so it showed nothing while
  orders owed 105 800 DA. The queue now lives in the repository, filters in SQL from the derived
  `paymentStatus`, and counts the whole table rather than a truncated page.
- **One controlled customer and one controlled staff account** were created through the
  application's own auth API, verified through the real OTP mechanism.
- **Two complete journeys were run through the interface**: a stock product from shop to order with
  its reservation, and a custom embroidery from the builder — including a real upload — through the
  request, the admin's quote, acceptance and the quote-bound checkout with its deposit.
- **Two defects the journey exposed were fixed**: delivery charged at a hundredfold rate, and a
  confirmation screen telling customers their upload had not arrived.

**Done when**: the database holds one clean controlled dataset, `/admin/payments` shows real
orders, and the full suite, the build, the probes and a fresh-database replay all pass. Met.

---

### Phase 14.7 — Bilingual storefront, dark mode, photography pipeline — **done**

Asked for by the owner, out of sequence: make the site bilingual, give it a light and a dark
theme, put photographs on the products, and make the homepage lead with a full-screen image.

**Delivered**

- **French and English, in the URL.** Every public page is `/fr/…` or `/en/…`; a visitor is sent to
  their language by `Accept-Language` and kept there by a cookie, and can switch from the header
  without losing the page they are on. Two root layouts in route groups — the storefront under
  `[locale]`, the workshop unprefixed and French. ADR-030.
- **One typed dictionary per language.** French is the source of truth and the type, so a key added
  to French and forgotten in English fails the build. `tests/unit/i18n.test.ts` also fails if an
  English value is still the French one, or if a `domain/` label map grows a status the storefront
  cannot name.
- **`hreflang` and a bilingual sitemap.** Every page canonicalises to itself and names the other,
  `x-default` included; the sitemap lists both languages for every URL.
- **Light and dark, from one set of tokens.** Each token declares both values on one line with
  `light-dark()`, so a visitor's system preference works with no JavaScript, and the toggle
  (light / dark / system) is stamped onto the document before the first paint. Fifteen components
  that had hard-coded an inversion were fixed, and four tokens added. ADR-031.
- **A public asset origin, and photographs in the layouts.** `NEXT_PUBLIC_PUBLIC_ASSET_URL` now
  accepts a root-relative path, `public/assets` is served as `/assets`, and `toPublicAssetUrl`
  resolves for the first time — product cards, product pages, the gallery and the social cards all
  show images. The 17 files in place are **clearly-marked placeholders**; `public/assets/README.md`
  says where a real photograph goes and what it should be.
- **The homepage leads with a full-screen image.** The hero fills the viewport under the header,
  with a two-gradient scrim carrying the type; where no image is configured it falls back to the
  previous split layout rather than to an empty box.
- **The suite covers both languages and both themes.** `tests/e2e/i18n.spec.ts` runs axe over the
  storefront in English and in the dark palette; the rest of the suite runs in a French browser.

**Deliberately not done**

- **The catalogue is not translated.** The homepage's bands are — each row carries an `en`
  overlay inside its `config` — but product names, descriptions, gallery captions, placements,
  thread colours and the banner strip are single-language rows and read in French in both
  languages. Translating them is a schema change, recorded in `PRODUCT.md`.
- **Messages returned by server actions are French in both languages** — they are produced where
  there is no request locale to read.
- **The workshop is neither translated nor themed.** It is French, light, and one small team's
  tool; its dark pass stays on Phase 12's list.
- **The photographs themselves.** The pipeline is real and the files are placeholders, by
  agreement: the owner supplies the photography.

**Done when**: both languages render every storefront screen, the theme survives a reload with no
flash, product imagery resolves from a real origin, and the whole suite — unit, integration, E2E,
build — passes. Met.

---

### Phase 14.8 — Product photography, the landing-page editor, a bilingual workshop, Bizeora — **done**

Four things the owner asked for, in one pass.

**Delivered**

- **Photographs, uploaded from the admin.** Up to eight per product: choose
  several at once, reorder them, name the main one, write the alternative text,
  delete one. The bytes pass through the server, which decodes them, applies the
  EXIF orientation, **drops the metadata** — a phone writes its GPS coordinates
  into every picture — caps the longest edge at 2400px and re-encodes as a
  progressive JPEG before anything reaches a public URL. `lib/storage` gained
  its first public prefix, `media/`, and `toPublicAssetUrl` resolves for the
  first time. ADR-032.
- **An editor for the landing page.** `/admin/content`: reorder the bands, switch
  one off without deleting it, edit every piece of copy **in both languages**,
  upload the hero photograph, set how many products or gallery pieces a grid
  shows, and edit the promotional strip. The form is generated from a
  declaration in `domain/content/editing`, so a band type that gains a setting
  gains a control without the screen changing.
- **The workshop speaks both languages.** Every admin screen reads from the
  dictionaries; the language is the same `NEXT_LOCALE` cookie the storefront
  uses, so `/admin/orders` keeps its address and the switcher sits in the
  sidebar. ADR-033.
- **Bizeora.** The placeholder brand is gone: the name, the wordmark, the page
  titles, the e-mail sender, the social cards and the legal name all read
  Bizeora, and the owner's logo is the favicon and sits in the footer.

**Fixed on the way**

- **Cache invalidation had been silently dead since the site became bilingual.**
  Every admin write called `revalidatePath('/shop')`, and the storefront's paths
  are `/fr/shop` and `/en/shop`; the route-pattern form does not reach a page
  inside two route groups either. It now invalidates one concrete path per
  language, and the landing-page editor's tests prove an edit reaches the front
  page rather than waiting five minutes.

**Deliberately not done**

- **No page builder.** The eleven band types are the page's vocabulary; the
  editor changes their order, their words and their images, not their shape.
- **The banner strip is still single-language**, because `banners` has no JSON
  column to hang an overlay from. Translating it is a migration.
- **Messages returned by server actions are French in both languages** — they
  are produced where there is no request locale to read (ADR-033).
- **No category management, and no gallery curation.** Both remain Phase 12's
  outstanding half.
- **The logo is the 150 × 150 raster the owner supplied**, shown on a light chip
  so it works on the dark palette. A transparent SVG would let it sit on the
  page directly.

**Done when**: the workshop can put a photograph on a product and a headline on
the front page without a developer, in either language, and the whole suite —
unit, integration, E2E, build — passes. Met.

---

### Phase 14.9 — Archiving, and selecting rows in bulk — **done**

The workshop's lists only ever grew. Nothing in the interface could take a row off one, and the
owner asked for a way to clear them — first as a delete, then, in the same breath, "maybe not
delete, just archive". The amendment is the whole design: see ADR-034 for why a delete button on a
list of receipts is a mistake with a nicer interface.

**Delivered**

- **`archived_at` on `orders`, `custom_requests`, `quotes` and `reviews`**, with a partial index on
  the live half. It is read by the admin's list queries and by nothing else: the customer's order
  page still renders, the record is intact, and restoring is one click.
- **Multi-select in every workshop list.** A checkbox per row, a header box that sweeps the table
  it sits in, and a bar that appears with the count and one button. Up to a hundred rows per act.
  The selection is held by row id, so it survives the refresh that follows a write, and it drops
  rows that have left the list rather than sending ids nobody can see.
- **An archive view per screen**, as a URL — `?archived=1` — carried through the status filters, so
  switching a filter does not drop the operator out of the half they are in.
- **Products archive through their own status**, which is customer-facing, so the catalogue's
  existing `Archivé` filter is its archive view. A **published** product is refused from a
  checkbox and the screen says how many were left alone; restoring returns a product to `DRAFT`,
  never to the shop.
- **One audit row per batch**, naming the person, the moment and the ids.
- **The payment screen follows the lists**: `/admin/payments`, its six facet counts and the
  outstanding total all exclude archived orders, so the figure agrees with the list beneath it.
- **Every string in both languages**, deliberately genderless in French so one set of words reads
  correctly over commandes, demandes, devis, avis and produits.

**Deliberately not done**

- **No automatic archiving.** A queue that empties itself is a queue that loses things.
- **No bulk anything else.** The bar archives and restores; it does not change statuses, send
  e-mails or edit prices. Those are decisions with consequences and they keep their own screens.
- **No archive for customers, gallery items or stock.** The customer directory is a directory
  rather than a queue, and the other two are Phase 12's outstanding half.
- **Exports and reports, when they exist, will count archived rows.** That is the same property
  that keeps the books honest (ADR-034).

**Done when**: the owner can tick several rows in any workshop list, clear them in one click, find
them again in the archive and put them back, in either language — and the whole suite passes. Met.

---

### Phase 14.10 — Visual placement — **done**

The builder asked where the embroidery should go and offered a list of names: chest, back, sleeve.
The owner asked for the real thing — "he uploads the image and starts hovering with it so he puts
it exactly where he wants" — and chose, when asked, freeform placement over named positions and the
box on the photograph as the size.

**Delivered**

- **A placement editor over a photograph of the garment.** The customer drops their artwork onto a
  blank hoodie or t-shirt, drags it, scales it, rotates it, and switches between front and back.
  Pointer, touch and keyboard; the artwork cannot leave the printable area.
- **A transform in texture space** — `x`, `y`, `width`, `rotation`, all percentages, `x`/`y` being
  the centre — so one number positions a design over a photograph and inside a 3D model's UV map.
  Height is never stored; it follows from the artwork's own aspect ratio. ADR-035.
- **Millimetres derived on the server** from `product_images.surface_width_mm`, which only the
  workshop can set. A millimetre figure from a browser is a price the browser chose.
- **The result drawn back for the workshop.** `PlacementPreview` composites the customer's artwork
  over the same photograph on the request, the quote and the order, so the person at the machine
  sees what the customer saw rather than a row of coordinates.
- **A `.glb` parser and a second public prefix, `models/`**, refusing any model that references a
  file outside itself. ADR-036.

**Deliberately not done**

- **The 3D viewer itself.** The parser, the storage prefix and the transform are built and tested;
  the component that renders a garment in the browser is not, and it needs a real model and a
  `three` dependency. The 2D editor is the shipped experience.
- **No admin card for uploading a model.** The server actions exist; the screen does not.

**Done when**: a customer can place their own artwork exactly where they want it, say how big it
is, and the workshop can see the result. Met.

---

### Phase 14.11 — One size, once, and a checkout with nothing spare — **done**

> "there are some fixed sizes but allow custome sizes and u only have to check the size if there is
> no custome one and only once pls"

and, in the same message, "do some polishing for all the website becvause im going to propose for
client".

**Delivered**

- **The size is asked once.** A custom size entered in the placement editor *is* the size; the
  fixed bands are offered only when there is no custom one, and nothing asks again later.
- **The e-mail address is optional at checkout.** `orders.contact_email` is nullable with a
  not-blank check, the customer notification is skipped rather than failed when there is no
  address, and the field is gone from the form. A shop whose customers order over WhatsApp should
  not refuse an order for want of an address.
- **The note field is gone**, for the same reason: a free-text box nobody reads is a promise the
  shop does not keep.
- **Polish across the admin workshop, the custom builder and the storefront's first impression**,
  which is what the owner is going to show a client.

**Done when**: a customer is asked for a size once and for an address never, and the three screens
the owner demonstrates look finished. Met.

---

### Phase 14.12 — The settings screen — **done**

> "change the name of the websites , turn the client on and off , turn email verification on and
> off ( when its off consider all of them are virified ) and you add what i need more"

The `settings` table had been read since Phase 2 and edited from a SQL client. Two of its rows had
already caused incidents: an empty `notifications.adminRecipients` silently dropped every "new
order" e-mail, and `brand.name` was seeded and then read from a TypeScript constant.

**Delivered**

- **`/admin/settings`**, admin-only, twelve settings in five groups: what the shop is called, whether
  it is open, how accounts behave, who the workshop tells, what it charges. One form, one save,
  every refusal shown at once, and a line under each field saying who last changed it.
- **A catalogue in `domain/settings`** that decides what is editable and what a valid value is. A
  key not on the list is refused; a deposit outside 0–100 % is refused on the screen and again on
  the server. ADR-037.
- **The shop's name is read from the row**, in every page title, the e-mails and the footer.
- **A kill switch for the public site.** Off, the shop, the builder, the cart, the checkout and the
  customer account become one page saying the workshop is still there, with a WhatsApp number if
  one is set. `/admin` is untouched, and `/login` moved into its own route group so that closing
  the shop cannot lock the owner out. It takes effect on the next request. ADR-038.
- **A switch for e-mail verification**, because a shop with no mail provider configured cannot send
  a confirmation and a requirement nobody can satisfy is a shop that cannot take an order. Off,
  every signed-in customer counts as confirmed and the account screen stops asking.
- **Five end-to-end tests that look at the public site**, not at the form: the renamed shop in a
  page title, the curtain seen by a stranger, sign-in still reachable behind it, the nag gone from a
  customer's account, and an impossible deposit refused.

**Deliberately not done**

- **No staff preview of a closed shop.** It cannot be done without reading a cookie, and a
  request-specific read inside a prerendered route is a 500 rather than a stale page. ADR-038
  records the attempt.
- **No secrets on the screen.** `is_secret` rows are not in the catalogue; an API key belongs in
  the environment, where it can be rotated without a database write.
- **Not every row is editable**, deliberately. `custom_orders.maxThreadColors` is a safety limit the
  pricing code assumes is sane, not a preference.

**Done when**: the owner can rename the shop, close it to the public and switch verification off,
and the public site agrees within one request. Met.

---

### Phase 15 — Security Hardening

**Goal**: the checklist in `SECURITY.md` section 16 is satisfied.

- Security headers and CSP with nonces
- Rate limits verified on every listed endpoint
- Upload pipeline penetration-tested with forged types, oversized files and malicious SVGs
- IDOR test suite across every customer-owned resource
- Audit logging verified for file access, PII views and status changes
- PII scrubbing in logs and error reports
- Secret scanning and dependency audit in CI
- Bucket policies verified from an unauthenticated client

**Done when**: every box in `SECURITY.md` section 16 is ticked with evidence.

---

### Phase 16 — Testing

**Goal**: the confidence to change things after launch. Written throughout; completed here.

- Unit tests for every module listed in `BUSINESS-RULES.md` section 16, including boundaries,
  rejections, rounding, and exhaustive state-machine rejection tables
- The three mandatory invariant tests from `BUSINESS-RULES.md` section 16: quote-to-order
  reconciliation across every line kind, freeze immutability under reference-data edits, and
  quote-bound cart isolation
- Integration tests: order placement, quote acceptance, stock reservation under concurrency,
  cart merge, upload validation, authorisation, notification dispatch idempotency
- E2E (Playwright): stock purchase as guest, custom fixed-price order, custom quote order end to
  end, reorder (V1.5), admin processes a request, admin fulfils an order
- Accessibility assertions on key routes
- CI runs unit and integration on every push, E2E on the main branch

**Done when**: the domain layer is comprehensively covered, all six E2E journeys pass on a clean
seeded database, and CI is green.

---

### Phase 17 — Performance

**Goal**: the budgets in `ARCHITECTURE.md` section 15 are met on a real device.

- Bundle analysis; dynamic imports for the builder preview, admin tables and dialogs
- Query-count audit on hot paths; indexes verified against `EXPLAIN`
- Image formats, sizes and placeholders verified
- Caching and tag invalidation verified end to end
- Streaming boundaries placed so the shell paints first
- Lighthouse and field-data checks on a throttled mobile connection

**Done when**: LCP, INP, CLS and both JavaScript budgets are met on the product page and the
builder, and no storefront page exceeds six queries.

---

### Phase 18 — Launch

**Goal**: live, with the owner able to operate it.

- Production environment, domain, TLS, environment variables — including `SEO_INDEXABLE=true`,
  which is what makes the site indexable at all (ADR-028), and a Lighthouse SEO run once it is on
- Real catalogue data, photography and content loaded
- Real shipping rates and settings configured
- Backups verified by performing a restore
- Sentry, uptime checks and alerting live
- Cron jobs scheduled and verified
- A short owner's operating guide: process a request, send a quote, fulfil an order, add a product
- Legal pages reviewed with real terms
- Analytics and Search Console connected
- Rollback procedure documented and tested

**Done when**: a real customer completes a real order, the owner fulfils it without assistance,
and backup restore and rollback have both been exercised.

---

## 3. Sequencing Notes

**Why this order.** Foundation and database first, because everything depends on the schema and
retrofitting boundaries is expensive. Auth before any feature, because every feature needs an
actor. The design system before screens, so components are not invented twice. Cart before
checkout before the builder, because the builder's fixed-price path terminates in the cart.
Quotes after the builder, because a quote prices a configuration. Admin after the customer flows,
because the admin operates on data the customer flows create.

**Parallelisable**: SEO, security and testing are worked continuously and merely _verified_ in
their named phases. Content and photography can be gathered at any time.

**Highest-risk phases**: 9 (custom builder — the most product surface and the upload pipeline) and
10 (quotes — the most state). Both deserve the most time and the most tests.

**A phase is not done when the code exists.** It is done when its definition of done is met,
including states, responsiveness, authorisation and tests.
