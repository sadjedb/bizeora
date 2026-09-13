# UX.md

> How people move through Bizeora. Product definition is in `PRODUCT.md`.
> Visual tokens and component specifications are in `DESIGN-SYSTEM.md`.

---

## 1. UX Principles

1. **Show the price before asking for anything.** Every step of the custom builder displays a
   running estimate. A customer never reaches a wall where the only option is "contact us".
2. **One decision per screen on mobile.** The builder is a sequence of single choices, not a
   long form with a submit button at the bottom.
3. **Progress is never lost.** Builder state persists locally and, once identified, server-side.
   Refreshing, switching apps, or taking a phone call does not restart the flow.
4. **The work is the hero.** Photography of actual embroidery carries the sales argument;
   the interface stays out of its way.
5. **Defer identity.** Authentication is requested at the last possible moment that still makes
   the flow work, and always with the reason stated.
6. **Every state is designed.** Loading, empty, error and success are specified before a screen
   is considered finished.
7. **The admin is a tool, not a showcase.** Density, keyboard access and speed beat polish.

---

## 2. Sitemap

### Public storefront

Product detail sits at `/shop/[slug]` and category listings at `/shop/c/[category]`. Phase 5
moved them: the original plan put products at `/products/[slug]` and categories at
`/shop/[category]`, but a product URL under `/shop` reads better and matches how customers talk
about the site — and two dynamic segments cannot share `/shop/*`, so the category listing takes an
explicit prefix. Phase 6 builds the category route.

```
/                             Home
/shop                         Catalogue (search, filter, sort, paginate)
/shop/[slug]                  Product detail
/shop/c/[category]            Category listing
/collections/[slug]           Collection listing                        (V1.5)
/custom                       Custom embroidery landing / entry point
/custom/builder               Multi-step configurator
/custom/builder/[draftId]     Resume a saved draft
/custom/request-sent          Submission confirmation
/gallery                      Our Work, filterable                       (Phase 13)
/gallery/[slug]               Gallery item detail                        (Phase 13)
/how-it-works                 Process explainer
/about                        About the business
/faq                          FAQ (database-backed)
/contact                      Contact form + WhatsApp + phone
/size-guide                   Sizing (database-backed page)
/care-guide                   Care instructions (database-backed page)
/privacy                      Privacy policy (database-backed page)
/terms                        Terms and conditions (database-backed page)
/cart                         Cart
/checkout                     Checkout (single page, sectioned)
/order/confirmation/[token]   Post-purchase confirmation (one-time token)
/track                        Guest order lookup (order number + phone)
/track/[orderNumber]          Guest order status (token-scoped)
```

Three machine-readable routes sit beside them, added in Phase 14 and listed here so they are not
mistaken for pages: `/robots.txt`, `/sitemap.xml`, and the generated Open Graph images
(`/opengraph-image` site-wide, `/shop/[slug]/opengraph-image` per product). The sitemap contains
only the public routes above and the published records behind them — never `/account`, `/admin`,
the cart, the checkout, a quote, a request or a guest order URL.

### Authenticated customer

```
/account                      Overview                                  (Phase 11)
/account/orders               Order list                                (Phase 11)
/account/orders/[number]      Order detail + status timeline            (Phase 11)
/account/requests             Custom requests                           (Phase 11)
/account/requests/[number]    Request detail, files, messages           (Phase 11)
/account/quotes               Quotes                                    (Phase 10)
/account/quotes/[number]      Quote detail: accept / reject             (Phase 10)
/checkout/quote/[cartId]      The accepted quote's own checkout         (Phase 10)
/account/designs              Design library                            (V1.5)
/account/wishlist             Wishlist                                  (V1.5)
/account/addresses            Saved addresses                           (not built)
/account/profile              Profile                                   (Phase 11)
/account/reviews              Write and follow your reviews             (Phase 13)
```

### Auth

```
/login  /register  /forgot-password  /reset-password/[token]  /verify-email/[token]
```

`/login` and `/register` were built in Phase 10, because only the customer a quote was addressed
to may accept it (`BUSINESS-RULES.md` 7.5). Everything else on the storefront stays guest-first:
browsing, the builder and the standard checkout still ask for no account. The remaining three
routes arrive with the account area in Phase 11.

### Admin

```
/admin                        Today dashboard
/admin/requests               Custom request queue  (default landing for the owner)
/admin/requests/[id]          Request workspace: files, config, notes, build quote
/admin/quotes                 Quotes
/admin/quotes/[id]            Quote editor / version history
/admin/orders                 Orders
/admin/orders/[id]            Order workspace: items, status, tracking, payments
/admin/products               Products
/admin/products/new           Create product
/admin/products/[id]          Edit product, variants, images
/admin/categories             Categories
/admin/collections            Collections                               (V1.5)
/admin/customers              Customer directory
/admin/customers/[id]         Customer detail
/admin/reviews                Review moderation                         (Phase 13)
/admin/gallery                Gallery curation
/admin/content                Homepage sections, banners, FAQs, pages, social links
/admin/coupons                Coupons                                   (V1.5)
/admin/settings               Brand, contact, shipping rates, custom-order settings, payments
```

---

## 3. Navigation

### Desktop header

Two rows on the homepage, one row (condensed, sticky) elsewhere.

```
[ Bizeora ]       Shop   Custom Embroidery   Our Work   How It Works   About
                                             [search] [account] [cart •]
```

- **Custom Embroidery** is visually emphasised (accent underline). It is the highest-value
  destination and must not read as one link among six.
- The cart shows a count badge; it opens a **slide-over**, not a page navigation, when items
  exist. `/cart` remains a real, linkable page.
- Search is an overlay with recent and suggested queries, not an inline input crammed into the bar.

### Mobile header

```
[ ☰ ]        Bizeora       [ search ] [ cart • ]
```

Drawer contents, in order: **Create Your Own** (primary button), Shop, Categories (accordion),
Our Work, How It Works, About, FAQ, Contact, then Account / Log in.

A persistent bottom-anchored bar appears on product and builder screens only, carrying the
single primary action for that screen. It is not a global tab bar — a five-icon tab bar would
make a fashion storefront feel like a utility app.

### Footer

Four columns: Shop (categories), Custom (builder, how it works, gallery), Help (FAQ, size guide,
care guide, contact, track order), Business (about, terms, privacy, social). Below: WhatsApp
number, phone, delivery note, currency.

### Floating contact

A single WhatsApp-first contact button, bottom-right, admin-configurable (enabled, number,
greeting text, which routes it appears on). Hidden on checkout and inside the builder's upload
step to avoid competing with the primary action.

---

## 4. Customer Journeys

### Journey 1 — Ready-made product

```
Home -> Shop -> Filter -> Product -> Select size/colour -> Add to cart
     -> Cart slide-over -> Checkout -> Confirmation
```

Decision points and the design response:

| Moment      | Risk                           | Response                                                           |
| ----------- | ------------------------------ | ------------------------------------------------------------------ |
| Landing     | Unclear what the business does | Hero states the value proposition in one sentence with two CTAs    |
| Catalogue   | Too many or too few options    | Category chips, sensible default sort, filter count always visible |
| Product     | Cannot judge quality           | Macro image in the gallery, always; embroidery detail block        |
| Variant     | Out of stock discovered late   | Unavailable combinations disabled at selection, not at add-to-cart |
| Add to cart | Flow interruption              | Slide-over confirms and offers "continue shopping" as the default  |
| Checkout    | Form fatigue                   | One page, three sections, guest by default, phone-first            |

### Journey 2 — Simple custom order (fixed price)

```
Home -> Create Your Own -> Product -> Placement -> Upload -> Options -> Review
     -> Add to cart -> Checkout -> Confirmation
```

Fixed pricing means no quote and no waiting. The customer buys immediately. Conditions under
which a configuration qualifies for fixed pricing are in `BUSINESS-RULES.md` section 2.3.

### Journey 3 — Complex custom order (quote)

```
Home -> Create Your Own -> Product -> Placement -> Upload -> Options -> Review
     -> Submit request (account created here) -> Confirmation screen with expected response time
     -> [admin reviews] -> Quote notification -> /account/quotes/[number]
     -> Accept -> Cart pre-loaded with the locked quote line -> Checkout -> Deposit -> Confirmation
```

The gap between submission and quote is the highest-risk moment in the product. Mitigations:

- The confirmation screen states an explicit expected response window pulled from settings,
  not a vague "we will get back to you".
- The confirmation screen shows the estimate range already given in the builder, so the customer
  leaves with a number.
- A WhatsApp deep link is offered: "Prefer to talk? Message us about request #1042."
- The request is visible in the account immediately, with its own status timeline.

### Journey 4 — Hybrid customisation

```
Product page -> "Add your embroidery" -> builder opens with product + variant pre-selected
             -> Placement -> Upload -> Options -> Review -> Cart or Quote
```

Entering from a product skips step 1. The builder shows the chosen product locked at the top
with a "change product" affordance.

### Journey 5 — Returning customer reorder _(V1.5)_

```
Log in -> Account -> Orders -> Order detail -> "Reorder"
       -> Cart pre-filled (variants re-validated, prices refreshed, design file re-linked)
       -> Review changes -> Checkout
```

Reorder never silently carries an old price. If anything changed — price, stock, a discontinued
variant — the cart shows a diff panel: "Two things changed since your last order."

### Journey 6 — Guest order tracking

```
/track -> Order number + phone -> Rate-limited lookup -> Status timeline (read-only)
```

No account, no PII beyond what the customer already supplied. See `SECURITY.md` section 9.

---

## 5. The Custom Embroidery Journey in Detail

Five steps, reduced from the specification's six by merging options and instructions. Every step
shows: a step indicator, the running estimate, Back, and a single primary action.

### Step 1 — Choose your product

- A grid of product-type cards: image, name, "from X DA", available colours as swatches.
- Cards are database-driven, ordered by the admin. Nothing is hard-coded.
- An "Other / not listed" card routes into quote mode with a free-text product description.
- Entering from a product page skips this step.

### Step 2 — Choose placement

- **Visual diagrams**, not a dropdown: a garment silhouette per placement with the zone marked.
- Placements are filtered by product type (a cap has no "back" placement).
- "Custom placement" reveals a short text field and forces quote mode.
- Selecting a placement is one tap; the estimate updates immediately.
- **The design preview lives from this step onward**, not only at review. Once a supported raster
  file exists, changing the placement changes the picture — which is the moment the preview earns
  its value. When the customer reaches this step before uploading, the preview area shows the
  product photo alone with the placement zone marked.

### Step 3 — Upload your design

- A large drop zone; on mobile, prominent "Take a photo" and "Choose file" actions.
- Accepts PNG, JPG, SVG, PDF. Limits and validation are in `SECURITY.md` section 6.
- After upload: thumbnail preview, file name, size, and Replace / Remove.
- Guidance shown inline, not in a modal: "High-resolution images with clear edges and few
  colours embroider best. Photographs and gradients usually do not."
- **Client-side pre-checks** (dimensions, size, type) give instant feedback, but the server
  re-validates everything.
- Low-resolution uploads produce a non-blocking warning, not a rejection — the owner decides.
- A "skip, I only want text" path exists and leads to a text-only configuration.
- **Preview availability is stated at upload, not discovered at review.** PNG and JPG produce a
  thumbnail and drive the on-product preview. SVG and PDF are accepted normally and show a file
  card with name, type and size, plus a plain line: _"We can't show a visual preview for this file
  type — your configuration summary below shows exactly what we'll make."_ This is framed as a
  limitation of the preview, never as a problem with their file, because SVG is the **best** format
  to send. See ADR-011.

### Step 4 — Customise

Grouped, progressively disclosed, product-dependent:

- **The garment**: colour (swatches), size (chips), quantity (stepper)
- **The embroidery**: size (Small / Medium / Large with real millimetre ranges), thread colours
  (a palette; count drives price), optional text with a font preview
- **Anything else**: the free-text instructions field, previously its own step

Merging instructions into this step removes a screen that most customers left blank.

### Step 5 — Review

- A summary card that reads like a spec sheet: product, colour, size, placement, design
  thumbnail, embroidery size, thread colours, text, quantity, instructions.
- The **design-on-product preview**, for PNG and JPG uploads: the image composited onto a product
  photo at the chosen placement anchor, scaled to the chosen embroidery size. Approximate, and
  labelled as such: "Indicative preview — not a stitch simulation." SVG and PDF show the
  configuration summary and the file card instead.
- Every line is editable in place, jumping back to the relevant step with state intact.

### Adding more than one product to a request

Two of the five target segments — small business and club or team — rarely order a single garment
in a single size. "20 polos, left chest, plus 5 caps, front" is one job, one quote and one order.
`custom_request_items` supports this; the builder must let a customer reach it.

The review step therefore carries a secondary action: **"Add another product to this request"**.

- It returns to step 1 with the uploaded design and the request retained, so the customer supplies
  the artwork once and applies it to several garments.
- The review step then lists every item, each independently editable and removable, with a combined
  estimate below.
- A single-item request is unaffected — the action is secondary and does not compete with the
  primary CTA.
- The same mechanism covers **size breakdowns**: 20 hoodies across three sizes is three items
  against the same design.

**Documented V1 limitation.** There is no dedicated size-breakdown control — a grid where the
customer enters 3 / 8 / 9 against S / M / L in one pass. In V1 that is achieved by adding an item
per size, which works but is tedious for a large spread. The dedicated control is a V1 stretch and
otherwise an early V1.5 enhancement; it needs no schema change, because each row it produces is
already a request item.

- The price block, in one of two forms:

**Fixed price**

```
Estimated total          3,800 DA
Delivery calculated at checkout
[ Add to cart ]
```

**Quote required**

```
Estimated range          12,400 - 14,900 DA
This configuration needs a human quote. We usually reply within 6 working hours.
[ Request my quote ]     [ Ask on WhatsApp ]
```

The reason quote mode was triggered is stated explicitly ("bulk quantity", "custom placement",
"complex artwork"), so the customer does not read it as a stall.

### Draft persistence

- Builder state is written to local storage on every step change (no design file bytes).
- Once the customer is identified, the draft is persisted server-side and resumable from any
  device at `/custom/builder/[draftId]`.
- Uploaded files attach to the draft immediately, so a lost session does not lose an upload.

---

## 6. The Quote Journey

### Customer side

| State             | What the customer sees                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Submitted         | "Received. We are reviewing your design." Request visible in account.                                             |
| In review         | Timeline entry with a timestamp.                                                                                  |
| Needs info        | A clear, specific ask ("we need a higher-resolution file") with a reply/upload control.                           |
| Quoted            | Notification; a quote page with itemised lines, total, expiry date, and a countdown.                              |
| Accepted          | "Accepted. Continue to checkout." A dedicated quote-bound checkout is created, with a visible validity countdown. |
| Acceptance lapsed | The quote-bound checkout is read-only, with "Request an updated quote" offered. The quote itself stays readable.  |
| Rejected          | Optional reason captured; a "start a new request" path offered.                                                   |
| Expired           | Read-only, with "request an updated quote" which clones the configuration.                                        |

The quote page shows every line — product, embroidery, setup fee, quantity discount, delivery —
because an itemised quote is what business customers need in order to approve a purchase
internally, and because it makes the price feel derived rather than invented.

**Ask a question** is a lightweight message thread on the request, not email. It keeps the
negotiation inside the record.

### Admin side

```
/admin/requests (queue, oldest-first, needs-attention pinned)
  -> Request workspace
     Left:   customer, configuration, files (view/download), previous orders
     Right:  quote builder
  -> Add lines (product / embroidery / setup / rush / delivery / discount)
  -> Internal note
  -> Preview as customer -> Send
  -> [customer accepts] -> "Convert to order" -> Order created, request closed
```

Design requirements for this workspace:

- Files open in a viewer, one click, no download needed for a first look.
- Line templates ("Standard setup fee", "Left chest, 2 colours") are one click each; the owner
  should not retype prices.
- Quantity-discount tiers apply automatically and are shown as an explicit line.
- Sending a quote is a confirmed action that shows exactly what the customer will see.
- Revising a sent quote creates version 2 and marks version 1 superseded.

---

## 7. Checkout Journey

Single page, three sections, no multi-step wizard. Sections collapse as completed.

```
1  Contact          Full name · Phone (primary contact) · Email (required, carries the confirmation)
2  Delivery         Wilaya -> Commune · Home or Desk · Address · Notes
3  Payment          Method · Order notes · Terms acknowledgement
   ------------------------------------------------------------------
   Summary (sticky on desktop, collapsible sheet on mobile)
   Items · Subtotal · Discount · Delivery · Total · Deposit due now
```

Rules the UI must reflect:

- **Guest by default.** An account is offered after purchase ("save your details"), not before.
  An order containing a quote-locked custom line requires an authenticated customer, and the
  page says why.
- **Phone and email are both required**, on every order including guest ones. Phone is the primary
  operational contact and is validated against Algerian formats; email carries the order
  confirmation and is what later lets a guest claim the order into an account. The email field
  states why it is needed: "We'll send your order confirmation here."
- **Mixed stock and custom carts ship once.** Where a cart contains both, the delivery estimate
  shown is the longest of the lines, with a note explaining it, and a suggestion to order the
  stock item separately if it is wanted sooner. Partial shipment is not a V1 capability
  (`BUSINESS-RULES.md` section 8.9) and the customer must learn that here, not afterwards.
- **Wilaya drives delivery.** Selecting a wilaya recalculates delivery server-side; desk versus
  home is a visible choice with distinct prices and delivery estimates.
- **Deposits are explicit.** For orders containing custom lines the summary shows
  "Due now: 6,550 DA (50% deposit) · Due on delivery: 6,550 DA".
- **Totals are always recomputed on the server.** The client renders values it was given.
- The cart is re-validated on entry: stock, prices, quote expiry. Any change is surfaced before
  the customer commits, never after.

### Quote-bound checkout

Accepting a quote produces its own checkout, separate from the shopping cart. The customer's
normal cart is untouched and still holds whatever was in it.

- The page is headed by the quote reference and reads as a confirmation of an agreed price, not as
  a cart. Lines are listed exactly as the quote itemised them — garments, embroidery, setup fee,
  delivery, discount — and none of them is editable.
- No "add more items", no quantity steppers, no coupon field. Their absence is explained in one
  line rather than left as a puzzle: _"This order matches quote Q-1042. To change anything, ask us
  for an updated quote."_
- Delivery is the quoted amount. The wilaya selector still appears for the address, but it does not
  reprice.
- The total is the accepted total, to the centime.
- **Deposit due now** is shown prominently, with the balance and when it falls due.
- An **acceptance-expiry countdown** is visible ("Valid until 12 March"). Once it lapses, the page
  becomes read-only and offers "Request an updated quote", which starts a new request from a clone
  of the same configuration (`BUSINESS-RULES.md` section 7.10).

### Paying a deposit

V1 collects deposits by bank transfer or CCP, with no payment provider. The flow must not feel
improvised:

1. After placing the order the customer lands on a page stating the amount due now, the account
   details, and the payment reference — **which is the order number**, so it is easy to read aloud
   or type into a transfer form.
2. The same page and the order page in the account both offer **"I've paid — upload proof"**,
   accepting a photograph or screenshot of the transfer receipt.
3. The order sits in _Awaiting payment_ with an honest explanation: nothing is reserved and nothing
   is being made yet.
4. The admin confirms or rejects the proof; a rejection returns a reason.
5. On confirmation the order becomes _Confirmed_ and the timeline records it.

The customer is never left guessing whether their money arrived. Rules are in
`BUSINESS-RULES.md` section 8.10.

### Confirmation

Order number, itemised summary, delivery estimate, what happens next (specific to whether the
order contains custom lines), a track-order link, a WhatsApp link, and — for guests — a
one-click "create an account to track this order" that pre-fills from the order.

---

## 8. Account Journey

**Overview** is a triage screen, not a vanity dashboard. Priority order:

1. Quotes awaiting your response (with expiry countdown) — the only place money is blocked
2. Orders in production or shipped, with the next expected event
3. Requests being reviewed
4. Recent orders
5. Quick actions: Start a custom order · Track an order · Contact us

Order detail shows the status timeline as a real vertical timeline with timestamps, built from
status history, with only customer-visible entries rendered. Internal notes are never exposed —
the `isCustomerVisible` filter is in the query, so an internal entry is not fetched rather than
hidden.

Built in Phase 11, with three deliberate limits recorded in `tasks/CURRENT.md`: `/account/profile`
displays the account and signs out but does not yet edit a name or a password; there is no address
book; and a guest order is not listed until it is claimed, which needs the post-purchase
account-creation flow. Everything else on this screen is live.

**The request thread is the customer's half of 6.7.** They may post a `MESSAGE`, and that is all:
answering a `NEEDS_INFO` question does not clear the block, because 6.7.3 gives that judgement to
the admin who asked. The copy says so at the point of answering rather than leaving the customer
to wonder why nothing moved.

---

## 9. Admin Journeys

### The owner's day

`/admin` answers one question: what needs me now.

```
GOOD MORNING

Today          Orders 12 · Custom requests 7 · Revenue 84,500 DA

NEEDS YOU
  #1042  Custom hoodie, 3 pcs      New request · 2h ago        Review
  #1041  Logo embroidery           Awaiting quote · 1d ago     Send quote
  #1038  Cap, 12 pcs               Quote expires in 6h         Follow up
  #1035  Order paid                Not yet confirmed           Confirm

IN PRODUCTION (4)   READY TO SHIP (2)   LOW STOCK (3)

RECENT CUSTOMERS
  Amina B.        Guest        2 orders    last: today
  Sofiane K.      Registered   5 orders    last: 2d ago
  Atelier Nord    Registered   1 order     last: 3d ago
```

Every row is a link to the workspace where the action can be completed. There are no
"informational" tiles that lead nowhere.

Built in Phase 12, with one deliberate departure from the sketch above: **there is no revenue
figure and no chart.** `PRODUCT.md` puts analytics in V2, and a number nobody can act on is worse
than blank space because it makes the screen look like it is working. The queues are new requests,
requests in review, outstanding quotes, accepted quotes, orders to confirm, deposits awaited and
work in fulfilment — every one of them a bounded server query, every row a link.

**Recent customers** is still not built; the customer directory exists at `/admin/customers` and
lists registered accounts only. **The low-stock column is built** — Phase 14.5 added it along with
the screen that acts on it, which is the condition section 9 puts on any figure appearing here.

### The shell (Phase 14.5)

A persistent **sidebar** from `lg`, grouped rather than a flat row: *Atelier* (Aujourd'hui),
*Ventes* (Demandes, Devis, Commandes, Paiements), *Catalogue* (Produits, Stock), *Clients* (Clients,
Avis). Below `lg` it is a top bar and a real drawer. Only routes that exist appear — the gallery,
content, settings and audit-log screens are Phase 12's outstanding half and are absent rather than
disabled.

Every list is a **table**, not a stack of cards, and folds into labelled blocks below `md` rather
than scrolling sideways. Filters are links and search is a `GET` form, so a filtered queue is a URL
somebody can bookmark and hand to a colleague.

### Journey — put a product on sale

`/admin/products` → **Nouveau produit** → the fiche (name, address, description, category, price,
state, stock policy, the four flags, details, SEO overrides) → save → the product's own page →
**Ajouter une option** (a size, a colour) → **Ajouter une variante** (a SKU and a combination) →
`/admin/stock` → **Ajuster** → *Mettre en ligne*.

Three things the flow insists on:

- It opens as a **draft**, under **`MADE_TO_ORDER`** (10.8). Publishing is a separate act from
  saving, and archiving is confirmed, because they are different decisions made at different
  moments.
- A variant is created **at zero** and stocked through an adjustment, so the first units on a shelf
  carry a ledger row like every other movement (ADR-029).
- Renaming writes the redirect 11.6 has always specified, and the form says so before the rename
  rather than after it.

### Journey — count a shelf

`/admin/stock`, filtered to *En alerte* or searched by SKU → **Ajuster** → a signed number, a
reason, an optional note. The dialog shows the arithmetic while it is typed — `12 → 15` — because an
operator counting a shelf thinks "three more than the system says", and a form that makes them
compute the total will eventually receive their mental arithmetic instead of their count.

Two refusals carry the safety of the screen, and both name the actual obstacle: stock cannot go
negative, and it cannot drop below what orders have already reserved — in which case the operator is
told to cancel the order first, because that is the operation that releases the units.

### Journey — the morning bank check

`/admin/payments` lists what is owed, what has been paid, what is left, and which transfers have a
justificatif waiting. It finds the work; recording a payment remains a human act performed in the
order workspace, which is where every row leads. There is no payment-provider integration.

**It opens on every order, not on a filter.** Phase 14.5 shipped it defaulting to the
justificatif queue, which is empty in a shop whose default method is payment on delivery, so the
screen greeted the morning bank check with an empty state while orders owed money. Phase 14.6
made the default `Toutes` and rebuilt the facets around the **money** rather than around the order
status: *Non réglées*, *Acompte attendu*, *Partiellement réglées*, *Soldées*, *Justificatifs à
vérifier*, each answered in SQL from the derived `paymentStatus` (8.8), plus a payment-method
filter. The old "acompte attendu" keyed off `status = AWAITING_PAYMENT`, so an order sitting in
`AWAITING_CONFIRMATION` with an untouched deposit — the commonest shape in this shop — never
appeared at all.

For a quote-bound custom order the deposit column shows the order's own `depositRequired`, copied
from the quote at placement rather than recomputed, with what is still missing before the order can
be confirmed underneath it (5.5).

**Recent customers** lists the most recent buyers across both halves of the customer directory —
registered users and guest contacts grouped by phone — each row labelled `Registered` or `Guest`,
showing lifetime order count and last order date, and linking to the customer detail view. It
exists because the owner's business is relationship-driven: recognising a returning buyer is the
prompt to follow up, and a guest with several orders is the clearest prompt to invite them to
create an account.

**The owner does not have to be watching this screen.** Admin-directed notifications fire on
`request.submitted`, `quote.expiring` and `order.placed` (`ARCHITECTURE.md` section 11), because
the six-hour quote promise cannot depend on someone remembering to log in.

### Journey — process a custom request

Review files -> check configuration -> add internal note -> build quote -> send -> await ->
convert to order. Covered in section 6.

### Journey — fulfil an order

Order list, filtered by status -> order workspace -> confirm -> mark in production ->
mark ready -> add tracking and mark shipped -> mark delivered. Each transition writes a history
entry and, where a customer-facing template exists, sends a transactional email.

Built in Phase 12. The status filter is a **URL**, so a queue can be bookmarked and returned to.
Only transitions the state machine allows are offered, and each asks for exactly what 8.7 requires
— a reason to cancel, a carrier and tracking number to ship, a note to hold. Cancelling is behind
a confirmation, because it releases stock and cannot be undone. The transactional e-mail is Phase
8A's and is not sent yet.

**The deposit loop** (8.10) is the other half: the customer sends a transfer receipt from their
order page, the workshop opens it in the workspace through a signed URL, accepts or refuses it
with a reason the customer reads, and records a payment. Recording a payment is what moves
`paymentStatus`; there is no control anywhere that sets it.

### Journey — add a product

Basics (name, category, description) -> images -> options (size, colour) -> generated variants
in a grid with per-variant SKU, price and stock -> customisation settings -> SEO -> publish.
Variant generation from options is the step that must feel effortless; typing 24 rows by hand
is where a small business gives up.

---

## 10. Conversion Opportunities

Ordered by expected impact.

1. **A visible price at every step of the builder.** The single highest-leverage element.
2. **The design-on-product preview.** Converts "I think this will work" into "I can see it".
3. **Macro embroidery photography above the fold.** Quality is the product; show it first.
4. **Social proof near the decision**, not on a separate reviews page — rating on product cards,
   reviews on the product page, a gallery strip inside the builder's product step.
5. **WhatsApp as a parallel path.** Some customers will never complete a form. Capturing them
   into a conversation is better than losing them, and the button costs nothing.
6. **Guest checkout.** Removes an entire screen from the highest-intent moment.
7. **An explicit response-time promise** on the quote confirmation screen.
8. **Quote expiry countdown.** Legitimate, non-manipulative urgency.
9. **Free-delivery threshold surfaced in the cart** ("Add 1,200 DA for free delivery"), driven
   by the shipping settings.
10. **Post-purchase account creation.** Captures the customer without taxing the purchase.
11. **Category and collection landing pages with real editorial copy** for organic search.
12. **"Reorder" as the first action on a past order** _(V1.5)_, for the repeat business segment.

---

## 11. UX Friction to Eliminate

Known failure modes, and the required design response.

| Friction                                 | Where               | Response                                                              |
| ---------------------------------------- | ------------------- | --------------------------------------------------------------------- |
| Login wall before a price                | Custom flow         | Identity requested only at submission, with the reason stated         |
| Dead end at "request a quote"            | Builder review      | Always show an estimate range plus a WhatsApp alternative             |
| Losing a long configuration              | Builder             | Local + server draft persistence, resumable links                     |
| Upload fails silently on mobile data     | Builder step 3      | Progress, retry, resumable upload, explicit error copy                |
| Not knowing whether the design is usable | Builder step 3      | Immediate resolution feedback, non-blocking warnings                  |
| Delivery price discovered at the end     | Cart / checkout     | Wilaya selector available in the cart; estimate shown before checkout |
| Silence after submitting a request       | Post-submission     | Response-time promise, visible status, timeline entries               |
| Out-of-stock discovered at add-to-cart   | Product page        | Unavailable variant combinations disabled at selection                |
| Not knowing when an order arrives        | Order tracking      | Status timeline with expected next event and date range               |
| Retyping an address every order          | Checkout            | Saved addresses; guest orders offer post-purchase save                |
| Admin retyping the same quote lines      | Admin quote builder | Saved line templates and default fees                                 |
| Admin losing a request in a long list    | Admin queue         | Needs-attention pinning, age indicators, saved filters                |

---

## 12. Mobile UX

Mobile is the primary target, not an adaptation.

**Layout**

- Single column below 768 px. Content max-width 100% with 16 px gutters.
- Bottom-anchored primary action on product pages and every builder step, above the safe-area
  inset. Never a floating action button that obscures content.
- Filters and sort open as full-height bottom sheets with an explicit Apply, so a mis-tap does
  not reload the listing.
- The cart is a full-height sheet, not a cramped dropdown.

**Touch**

- Minimum target 44 x 44 px, 8 px minimum spacing between adjacent targets.
- Swatches and size chips are large tap targets with a text label, never colour alone.
- Horizontal scrollers (product carousels, gallery strips) snap and show a partial next card so
  the affordance is obvious.

**The builder on mobile**

- Steps occupy the full viewport. The step indicator is compact and non-scrolling.
- The estimate is pinned above the primary action, always visible.
- Placement diagrams are large and tappable, at least 2 per row, never a select element.
- Upload offers camera capture first. Progress is shown; the app can be backgrounded without
  losing the upload.
- The review step's preview is pinch-zoomable.

**Checkout on mobile**

- Correct `inputmode`, `autocomplete` and `enterkeyhint` on every field.
- Phone field defaults to the numeric keypad with the country prefix pre-filled.
- The summary is a collapsible sheet, collapsed by default, with the total always visible.
- No fixed-position element may cover the submit button when the keyboard is open.

**Admin on mobile**

- The dashboard, the request queue and order status changes must work on a phone; the owner will
  use one. Product editing and quote building are desktop-first, with a readable, non-broken
  mobile fallback rather than a claimed full experience.

---

## 13. Interface States

Every screen specifies all four. A screen without them is not finished.

### Loading

- **Route-level**: skeletons that match the final layout's geometry, so nothing shifts.
  Product grid, product detail, order list, admin tables each have a dedicated skeleton.
- **Action-level**: buttons enter a pending state with a spinner and disabled input; label text
  stays readable ("Adding..." not a bare spinner).
- **Optimistic** updates for cart quantity and wishlist toggles, reverted with a toast on failure.
- **Never** a full-page spinner on navigation. Never a layout that jumps when data arrives.
- Slow operations over ~2 s (file upload, quote send) show determinate progress.

### Empty

Empty states state the situation, explain the next action, and give one button. Never a bare
"No results".

| Screen           | Copy                                                                        | Action                          |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------- |
| Cart             | "Your cart is empty."                                                       | Shop products · Create your own |
| Search / filters | "No products match these filters."                                          | Clear filters                   |
| Orders           | "No orders yet."                                                            | Shop products                   |
| Requests         | "You have not requested any custom embroidery yet."                         | Start a custom order            |
| Quotes           | "No quotes right now. Quotes appear here once we have priced your request." | View my requests                |
| Designs (V1.5)   | "Your saved designs will appear here."                                      | Start a custom order            |
| Wishlist (V1.5)  | "Nothing saved yet."                                                        | Browse the shop                 |
| Admin requests   | "No requests waiting. Everything is handled."                               | —                               |
| Admin products   | "No products yet."                                                          | Add your first product          |

### Error

- **Field-level**: inline, adjacent to the field, tied by `aria-describedby`, stating what to do.
- **Form-level**: a summary at the top of the form listing failed fields as anchor links.
- **Action-level**: a destructive-variant toast with a Retry action where retry is safe.
- **Route-level**: an error boundary with a plain explanation, a retry, and a route home.
  Never a stack trace; never "Something went wrong" alone.
- **404**: a real page with search and links to Shop and Custom.
- Errors name a cause the customer can act on. "Your card was declined" is useful;
  "Error 500" is not.

Specific errors that must have designed copy: upload rejected (type / size / unsafe file),
upload failed (network), variant out of stock during checkout, quote expired before acceptance,
**quote acceptance validity lapsed**, coupon invalid or expired, coupon attempted on a quote-bound
checkout, payment method unavailable for this order type, deposit proof rejected by the admin,
session expired mid-checkout, and — most carefully — **a blank that has become unavailable since
the quote was accepted**.

That last case matters more than its frequency suggests: the customer has already agreed a price
and committed. The screen must name the affected item, keep the quote-bound checkout intact rather
than discarding it, explain that the business is being notified, and offer "Contact us about this
order" with the reference pre-filled. It must never present as a generic failure.
(`BUSINESS-RULES.md` section 10.9.)

### Success

- **Inline** for reversible in-place changes (quantity, profile saved): a quiet confirmation.
- **Toast** for background actions (added to cart, note saved), auto-dismissing, with an undo
  where undo is possible.
- **Full screen** for milestones: order placed, request submitted, quote accepted. These state
  what happens next and by when, and offer exactly one primary continuation.
- Success is announced to assistive technology through a polite live region.

---

## 14. Content and Tone

Confident, plain, unfussy. Short sentences. No exclamation marks. No hype adjectives.

Standard calls to action: **Create Your Own · Start Custom Order · Shop Embroidery ·
View Our Work · Get a Quote · Shop Now · Explore Collection · Request My Quote · Add to Cart**

Recurring headline: _"Have an idea? Let's stitch it."_

Placeholder content is realistic embroidery-business content, never lorem ipsum, and every string
is authored as if a customer will read it in production — because they will.

---

## 15. Accessibility in the Flow

Detailed requirements are in `DESIGN-SYSTEM.md` section 14. In flow terms:

- The builder is completable by keyboard alone; each step moves focus to its heading on entry.
- Step changes are announced ("Step 3 of 5, Upload your design").
- Placement selection is a radio group with real labels; the diagrams are decorative images.
- Colour swatches carry a visible or accessible text name; colour is never the only signal.
- Price changes are announced through a polite live region.
- The cart count is announced on change.
- Form errors move focus to the first invalid field and announce the summary.
- Order status uses a label plus an icon, never colour alone.
