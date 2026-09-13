# PRODUCT.md

> Product definition for the Bizeora custom embroidery platform.
> Technical architecture lives in `ARCHITECTURE.md`. Rules and calculations live in `BUSINESS-RULES.md`.

---

## 1. Product Definition

Bizeora is an online **custom embroidery ordering platform** for a small Algerian embroidery
business, combined with a **ready-to-wear e-commerce store**, a **customer portal**, and an
**operations dashboard** for the owner.

One line:

> Turn your ideas into embroidery — order custom embroidery, or buy ready-made embroidered
> pieces, from a shop that looks and behaves like a premium fashion label.

The platform replaces the business's current sales channel (informal ordering over WhatsApp,
Instagram DMs and phone calls) with a structured system that captures the request, prices it,
tracks it through production, and keeps a record of the customer relationship.

---

## 2. Problem Statement

Custom embroidery is a **high-consideration, low-standardisation** purchase. The current
informal channel fails in four ways:

1. **Requests arrive incomplete.** "Can you embroider this?" with no product, no size, no
   placement, no quantity. Every order costs several rounds of messages before it can be priced.
2. **Pricing is invisible.** The customer cannot see any price until the owner replies, so many
   never convert. The owner re-derives prices from memory, inconsistently.
3. **Nothing is tracked.** Design files are scattered across chat threads. Order state lives in
   the owner's head. Customers ask "is it ready?" and the owner has to remember.
4. **The business looks smaller than it is.** The quality of the actual embroidery is the main
   asset, and it is invisible online.

The platform's job is to turn an ambiguous conversation into a **structured, priced, trackable
order** without making the customer feel like they are filling in a form.

---

## 3. Business Model

Three commercial flows share one catalogue, one cart, one checkout, and one order pipeline.

### A. Shop — ready-made products

Stocked embroidered products with fixed prices.

```
Product -> Variant -> Cart -> Checkout -> Order -> Pick/Production -> Delivery
```

Deterministic pricing. No approval step. This is the conversion baseline and the revenue floor.

### B. Custom embroidery — customer-supplied design

The customer configures a piece from scratch in the custom builder.

```
Choose product -> Placement -> Upload design -> Options -> Review
   (fixed price) -> Add to cart -> Checkout
   (quote price) -> Submit request -> Admin review -> Quote -> Accept -> Checkout
```

Two pricing modes, decided by the system, not the customer. See `BUSINESS-RULES.md` section 2.

### C. Hybrid customisation — customise an existing product

An existing catalogue product flagged customisable can be customised in place from its product
page: same blank, same variants, plus a design and a placement.

```
Product page -> "Add your embroidery" -> builder (pre-filled product) -> Cart or Quote
```

Hybrid is **not a third code path**. It is the custom builder entered with the product and
variant already chosen. This is the single most important structural decision in the product:
_there is one customisation engine, used from three entry points._

### Revenue mix assumption

Custom and hybrid orders are expected to carry the higher margin and to be the reason customers
arrive. The shop exists to (a) convert visitors who are not ready to design anything, (b) give
the brand a browsable catalogue for SEO, and (c) keep the blanks catalogue honest — the same
product records back both flows.

---

## 4. Target Customers

| Segment                     | Who                                                                                                  | What they need                                                   | Primary flow             |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------ |
| **Individual / gift buyer** | Buys one or two pieces: a name on a hoodie, a date, a small logo. Mobile, price-sensitive, hesitant. | Reassurance, a visible price, proof of quality                   | Custom (fixed) or Shop   |
| **Small business / brand**  | Cafes, gyms, barbershops, startups embroidering a logo on staff wear. 5-50 pieces.                   | Fast quote, consistent repeat orders, an invoice-shaped document | Custom (quote)           |
| **Club / team / event**     | Sports clubs, schools, weddings. Bulk, deadline-driven, seasonal.                                    | Bulk pricing, a firm delivery date                               | Custom (quote)           |
| **Workwear buyer**          | Contractors, clinics, restaurants ordering branded workwear.                                         | Durability information, sizing across many people, reorder       | Custom (quote) + Reorder |
| **Browser / shopper**       | Arrived from Instagram, wants something already made.                                                | A good catalogue, fast checkout, trust                           | Shop                     |

Two of these five (small business, workwear) are **repeat** customers. Reorder and saved designs
are therefore not a nice-to-have; they are the retention mechanism for the highest-value segment.
They sit in V1.5 only because V1 must ship first.

### Locale assumptions

- Primary market: **Algeria**. Currency **DZD**. Delivery by wilaya, home or desk (stopdesk).
- Interface languages: **French and English**, French by default. This is a Phase 14.7 change to
  what this section said before — it named Arabic as the likely second locale and V1 as
  single-language. The owner asked for English, and the reason is the customer list: the shop sells
  to Algerian customers who read French and to diaspora and business customers who do not. Arabic
  remains plausible as a third; adding one is now a dictionary and a line in `LOCALES` (ADR-030).
  The homepage's own bands are translated, through an `en` overlay inside each row's `config`, and
  **the workshop is too** since Phase 14.8 — its language is a cookie rather than a URL segment
  (ADR-033). **The catalogue is not**: product names, descriptions, gallery captions and the banner
  strip are single-language rows and read in French in both languages. See `ARCHITECTURE.md`
  section 4.
- **Phone is the primary identity and contact channel.** Email is secondary. WhatsApp is where
  customers actually expect to be reached.

---

## 5. Product Goals

Ranked. When two goals conflict, the higher one wins.

1. **Make a custom order completable on a phone in under three minutes.** This is the product.
2. **Show a price, or a price range, before asking for contact details.** Silence loses the sale.
3. **Make the embroidery quality visible.** Macro photography is the strongest sales asset.
4. **Give the owner one screen that answers "what do I do today?"**
5. **Never lose a design file or a request.**
6. **Look and feel like a premium label**, so the business can charge premium prices.
7. **Sell ready-made products** through a conventional, frictionless store.
8. **Stay maintainable by one person** (or one person plus an AI assistant).

### Non-goals for V1

- Multi-vendor, multi-tenant, or franchise support.
- Automated stitch-count or digitising price computation from uploaded artwork.
- A photorealistic embroidery renderer.
- Direct integration with embroidery machine software (DST/PES generation).
- International shipping and multi-currency.
- A mobile app.

---

## 6. Success Metrics

| Metric                                                | Why it matters                            | V1 target         |
| ----------------------------------------------------- | ----------------------------------------- | ----------------- |
| Custom builder completion rate (started to submitted) | The core funnel                           | >= 40%            |
| Quote acceptance rate (sent to accepted)              | Pricing credibility                       | >= 50%            |
| Median time from submission to quote sent             | The owner's responsiveness is the product | < 6 working hours |
| Shop conversion rate (session to order)               | Baseline commerce health                  | >= 1.5%           |
| Repeat order rate at 90 days (business segment)       | Retention                                 | >= 25%            |
| Mobile share of completed custom orders               | Validates mobile-first                    | >= 70%            |
| Orders needing an out-of-band clarification message   | Measures how good the intake form is      | <= 20%            |

These are stated so the analytics event taxonomy (`ARCHITECTURE.md` section 13) has a purpose.
They are targets to instrument, not commitments.

---

## 7. Core Features

### Storefront

- Editorial homepage with admin-managed sections
- Product catalogue: search, category, filters, sorting, pagination
- Premium product pages with variant selection and a gallery
- Embroidery gallery ("Our Work") with filtering
- How It Works, About, FAQ, Contact, Size Guide, Care Guide, legal pages
- Product reviews, admin-moderated

### Custom builder

- Multi-step configurator: product, placement, design, options, review
- Private file upload (PNG, JPG, SVG, PDF) with preview and replace
- Placement chosen from visual diagrams, not a dropdown
- A live estimate or estimate range at every step
- Draft persistence and resume
- Lightweight design-on-product preview overlay

### Quotes

- Structured quote with itemised lines (product, embroidery, setup, delivery, discount)
- Versioned; a revised quote supersedes rather than mutates
- Expiry date; accept, reject, or ask a question from the customer's account
- An accepted quote converts to a locked cart line and then an order

### Commerce

- Cart supporting stock lines and custom lines side by side
- Checkout with the Algerian address model (wilaya, commune, home/desk delivery)
- Modular payment layer; Cash on Delivery in V1
- Order confirmation and order tracking

### Customer portal

- Overview, orders, custom requests, quotes, addresses, profile
- Order timeline built from status history
- Design library, wishlist and reorder in V1.5

### Admin

- Operational dashboard: today's orders, revenue, requests needing attention
- Product, variant, category, collection and image management
- Custom request queue: review files, price, build and send quotes
- Order management: status, tracking, notes, payment status
- Customer directory, review moderation, gallery, content, settings

---

## 8. Capabilities

### A customer can

- Browse, search and filter the catalogue without an account
- Add stock products to a cart as a guest and check out as a guest
- Start and complete a custom configuration without an account
- Create an account at the point of submitting a custom request or a quote-bound order
- Upload design files that remain private to them and the business
- Receive, review, accept or reject a quote, and ask a question about it
- Track an order's full status timeline
- Look up an order without logging in, using order number plus phone
- Save addresses, review a purchased product, and manage their profile
- _(V1.5)_ Save designs, keep a wishlist, and reorder a previous order

### A customer cannot

- See another customer's order, request, quote, or design file
- Rely on any price computed on the client
- Make a design file public without an explicit consent action
- Change an order once it has entered production

### An admin can

- Manage the full catalogue, categories, collections, images and stock
- Work a queue of custom requests, download design files, and record internal notes
- Build itemised quotes, send them, revise them, and convert acceptances into orders
- Advance order status, record tracking, and record payments
- Moderate reviews, curate the gallery, and edit storefront content and settings
- View customer contact details and order history

### An admin cannot

- Bypass server-side validation from the admin UI
- Publish a customer's design to the public gallery without a recorded consent flag
- Access a design file without that access being written to the audit log

---

## 9. Improvements Over the Original Specification

Each of these is a deliberate deviation. Reasoning is recorded in `DECISIONS.md`.

1. **Quote states removed from the order status enum.** The original specification lists
   `Quote Sent` and `Quote Accepted` as order statuses, but a quote exists _before_ an order
   does. Quoting is the lifecycle of a custom request, not of an order. See ADR-004.
2. **One order pipeline, not two.** Custom orders become normal orders whose line items carry a
   customisation, rather than a parallel custom-order table with its own statuses, admin screens
   and fulfilment logic. See ADR-003.
3. **Guest checkout for stock products.** The specification implies accounts throughout.
   Requiring an account before a first purchase is the largest avoidable conversion loss. Custom
   requests still require an account, because a quote needs somewhere durable to live. See ADR-005.
4. **A price estimate is always shown**, even in quote mode, as a range with an explicit
   "final price confirmed in your quote" caveat. Never send a customer away with no number.
5. **A lightweight design-on-product preview moves into V1, for raster uploads.** The
   specification defers all preview to V1.5. A static overlay of a PNG or JPG onto a product photo
   at stored placement anchors is cheap, needs no server-side image processing, and is the
   strongest reassurance mechanism in the flow. It updates from the placement step onward. SVG and
   PDF are accepted as uploads but get no visual preview in V1, which keeps a PDF rasteriser out of
   the stack. The photorealistic version stays in V2. See ADR-011.
6. **Custom orders require a deposit; they are not eligible for full Cash on Delivery.** A hoodie
   carrying a stranger's logo has no resale value. COD refusal risk on personalised goods is an
   existential margin problem for a small shop. See ADR-008.
7. **A `NEEDS_INFO` state is added to the request lifecycle.** In practice the most common admin
   action on a new request is "this file is too low-resolution, please send another." Without
   this state the admin has to leave the system to make progress.
8. **Quotes are versioned and immutable once sent.** Renegotiation is normal in B2B embroidery.
   Editing a sent quote in place destroys the record of what the customer actually agreed to.
9. **Static pages (About, FAQ, Size Guide, Care Guide, Terms, Privacy) are database-backed.**
   The owner is not a developer and will want to change delivery text and FAQs constantly.
10. **The generic embroidery-colour entity is replaced by three small typed reference tables** —
    thread colour, embroidery font, embroidery size — rather than a generic option/EAV structure.
    See ADR-007.
11. **WhatsApp is treated as a first-class notification channel from day one** at the interface
    level, even though V1 ships only email plus a click-to-chat link. In this market an emailed
    "your quote is ready" will frequently not be read.
12. **"Best seller" is an admin flag in V1**, not a computed metric. Computed ranking needs order
    volume that does not exist yet.
13. **"Buy Now" is removed from V1.** It is a second checkout path to maintain, with negligible
    benefit under Cash on Delivery.
14. **An accepted quote gets its own checkout, not a shared cart**, and quote fees survive as
    explicit line items. Without this, an accepted quote's setup and rush fees are lost at
    checkout and its negotiated delivery is charged twice. See ADR-015.
15. **A customisation freezes when its quote is sent, not when it is accepted**, and carries
    display snapshots so a later rename or re-pricing of reference data cannot change how a
    historical order reads. See ADR-010 and ADR-016.
16. **Email is required on every order, guest included.** Without it there is no confirmation to
    send and no way to claim the order later. See ADR-005.
17. **Transactional email and admin notifications are V1, not V1.5.** Password reset already
    requires a working sender, and a quote nobody is told about defeats the response-time promise
    the product is built around.
18. **The review step allows adding another product to a request.** Bulk buyers — the highest-value
    segment — order several garments and several sizes in one job. The data model always supported
    it; the flow now does too.

### Removed or deferred

- Photorealistic embroidery rendering: V2
- Automated stitch-count pricing: V2
- Abandoned-cart recovery: V2 (the data model accommodates it; the feature does not ship)
- Customer segmentation, advanced inventory, production scheduling: V2
- Collections: V1.5 (categories cover V1; collections are a merchandising layer)

---

## 10. Key Assumptions

Implementation depends on these. Each is a place where being wrong costs rework.

**Business**

1. A single business, single brand, single warehouse. No multi-tenancy.
2. One owner plus, later, a small number of staff. Roles: customer, staff, admin.
3. Order volume in year one is in the low hundreds per month, not thousands.
4. The owner prices quotes manually. No automated pricing formula exists yet.
5. Blanks (undecorated garments) are held as stock; embroidery is made to order.

**Commercial** 6. Currency is DZD, stored in minor units, single currency in V1. 7. Cash on Delivery is the default payment method for stock orders. 8. Custom orders require a deposit or prepayment before production starts, collected offline by
bank transfer or CCP and confirmed manually by the admin. 9. Shipping is priced per wilaya and differentiated by home versus desk delivery. Free-delivery
thresholds are set per rate, not globally. 10. No VAT is applied in V1, but the totals model carries a tax field so it can be turned on.
10a. An order is a single fulfilment unit. Partial shipment is not a V1 capability, so a mixed
stock-and-custom order ships once, when everything is ready.
10b. Blanks used for custom work are made to order by default rather than stock-tracked.

**Technical** 11. Deployment is a single Next.js application on a managed platform with managed Postgres. 12. Design files are small — typically under 20 MB, hard limit 25 MB, at most 5 files per request. 13. Product photography is supplied by the business; the platform does not generate it. 14. Real content, not lorem ipsum, is used for all placeholder copy.

**Customer behaviour** 15. Most traffic is mobile, arriving from Instagram. 16. Customers abandon a custom flow that asks for a login before showing a price. 17. Customers expect a human to be reachable; a contact CTA must be permanently visible.

---

## 11. V1 Scope

V1 is the **complete commercial product**: a visitor can buy a stock item, or configure and order
custom embroidery, and the owner can run the entire business from the admin.

### In V1

| Area           | Included                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storefront     | Home, Shop, Product, Category, Custom, How It Works, Gallery, About, FAQ, Contact, Size Guide, Care Guide, Privacy, Terms                                  |
| Catalogue      | Products, variants (option/value model), images, categories, tags, stock                                                                                   |
| Custom builder | Five steps, private uploads, visual placements, live estimate, draft resume, raster preview overlay from the placement step, add-another-product on review |
| Quotes         | Full lifecycle, itemised lines, versioning, freeze-on-send, send expiry and acceptance validity, accept/reject, question thread                            |
| Cart           | Standard cart (stock and custom lines) plus quote-bound checkout, server-computed totals                                                                   |
| Checkout       | Guest and authenticated, email required, Algerian address model, COD, offline deposit flow for custom                                                      |
| Orders         | Single pipeline, fee line items, status history, tracking, guest order lookup                                                                              |
| Notifications  | Transactional email to customers and to the admin, via the outbox                                                                                          |
| Accounts       | Register, log in, reset password, overview, orders, requests, quotes, addresses, profile                                                                   |
| Admin          | Dashboard, products, categories, custom requests, quotes, orders, customers, reviews, gallery, content, settings                                           |
| Reviews        | Verified-purchase reviews with admin moderation                                                                                                            |
| Gallery        | Curated items with filtering                                                                                                                               |
| Cross-cutting  | Auth, authorisation, private storage, server-side validation, SEO, responsive UI, accessibility, loading/empty/error/success states                        |

### Explicitly not in V1

Collections, wishlist, saved designs, reorder, coupons, WhatsApp and marketing notifications,
design preview for SVG and PDF, photorealistic mockups, analytics persistence,
online payment providers, carrier API integration, abandoned cart, production scheduling,
partial shipment and per-line fulfilment, a dedicated size-breakdown control, **translated
catalogue content** (the interface, the workshop and the homepage's bands are bilingual since
Phases 14.7 and 14.8; the catalogue rows are not).

### V1 definition of done

- A customer can complete both purchase paths end to end on a phone.
- The owner can run a full day of business without touching the database.
- No customer can reach another customer's data by changing an identifier.
- No design file is reachable without an authorisation check.
- Pricing has exactly one implementation and it is unit tested.

---

## 12. Future Capabilities

### V1.5 — retention and merchandising

Collections, wishlist, saved design library, reorder, coupons with redemption limits, WhatsApp
templated notifications and marketing messages, customer channel preferences, advanced stock
(low-stock alerts, backorder), product bundles, analytics persistence, staff two-factor
authentication, a dedicated size-breakdown control, and SVG preview rasterisation if it proves
to matter.

### V2 — automation and scale

Automated embroidery pricing from artwork analysis, photorealistic mockups, WhatsApp Business API
automation, abandoned-cart recovery, analytics dashboards, customer segmentation, online payment
providers, carrier API integration (Yalidine, ZR Express), a production board and machine
scheduling, a third interface language (Arabic) with the right-to-left work it implies,
translated catalogue content, multi-currency.

Architecture constraints that keep these options open are listed in `ARCHITECTURE.md` section 16.
