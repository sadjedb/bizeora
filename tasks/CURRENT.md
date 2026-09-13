# CURRENT.md

## Current Sprint / Focus

**Phase 14.12 — The settings screen. Complete.**

The `settings` table had been read since Phase 2 and edited from a SQL client.
The owner asked for a screen: rename the shop, turn the client side on and off,
turn e-mail verification on and off. There is one now, at `/admin/settings`,
admin-only, and the two ADRs it produced are about what it is allowed to write
(ADR-037) and about what "turn the client side off" has to mean when the
storefront is cached (ADR-038).

The next thing worth building is the **3D viewer** Phase 14.10 left on the
shelf: the `.glb` parser, the public `models/` prefix and the texture-space
transform are all built and tested, and nothing renders a garment yet. After
that, Phase 15.

---

## TASK-027: Phase 14.12 — The settings screen

Status: DONE

Related docs: `docs/ROADMAP.md` Phase 14.12, `docs/BUSINESS-RULES.md` 12.1, 12.7
and 12.8, ADR-037, ADR-038

### What was asked

> "ok can u add a section of settings in the admin on where i can : change the
> name of the websites , turn the client on and off , turn email verification on
> and off ( when its off consider all of them are virified ) and you add what i
> need more"

and, when asked what "the client" meant:

> "i meant the client side of the website"

So: a maintenance switch, not a customer record.

### What was built

`/admin/settings`, admin-only, twelve settings in five groups — identity,
availability, accounts, notifications, custom pricing. One form and one save,
every refusal shown at once, and a line under each field naming whoever last
changed it.

The "what I need more" half is the four rates that had only ever been editable
in SQL: the setup fee, the text surcharge, the per-colour surcharge, the deposit
percentage, plus the quote validity, the setup-fee waiver quantity, the response
time the front page promises and the workshop's own notification addresses. That
last one had already caused an incident — it was empty, which silently dropped
every "new order" e-mail to the workshop.

### The three decisions worth remembering

**What may be written is a hand-written list, not the table** (ADR-037).
`EDITABLE_SETTINGS` in `domain/settings` names the twelve keys, their kinds and
their bounds. `custom_orders.maxThreadColors` is deliberately absent: it is a
safety limit the pricing code assumes is sane, not a preference. A key that is
not on the list comes back as `UNKNOWN_KEY` rather than being dropped, so a
crafted payload cannot look like a successful save.

**Closing the shop is a layout, and sign-in is not part of the shop**
(ADR-038). The gate is in `(storefront)/layout.tsx`, so it covers the catalogue,
the builder, the cart, the checkout and the customer's account in one place.
`/login` moved to a new `(entrance)` group beside it — same URL, same shell, no
gate — because `/admin` sends a signed-out visitor to `/login` and an owner who
closed the shop and then lost their session would otherwise have locked
themselves out of their own business.

**There is no staff preview, and the reason is worth keeping.** The first
implementation let signed-in staff through to the real site with a banner.
Recognising them means reading a cookie; reading a cookie makes a render
request-specific; and Next refuses that inside a route it has been told to
prerender. `/fr`, `/fr/shop` and `/fr/custom` returned **500** the moment the
shop closed — not a stale page, an error page. Closed now means closed for
everybody, and reopening is one click.

### The cache, and three attempts at it

This is the part that took the time, and the lesson generalises.

The storefront's three hot pages are prerendered with `revalidate = 300`. A
switch that only writes a row changes nothing a visitor sees for five minutes.

1. **A five-second memo on the settings read.** Made the query cheap; did
   nothing about the cached pages, which is where the staleness actually was.
2. **A cache tag on the settings read** (`unstable_cache` + `updateTag`). Fixed
   that window and opened a worse one: the entry then lived until something
   invalidated it, so the seed, a migration or a hand-written `UPDATE` never
   arrived at all.
3. **What works**: the settings read is memoised **per request** with React's
   `cache()`, and the save action invalidates the pages —
   `revalidatePath('/(site)/[locale]', 'layout')`.

The third point is the one that was not obvious. A prerendered page carries the
tags Next derived from its *internal* route, route groups included. `/fr` is
stored under `_N_T_/fr` and `_N_T_/(site)/[locale]/layout`, and under nothing
else — so `revalidatePath('/fr', 'layout')`, which looks exactly like the
concrete form rule 9C asks for, produces `_N_T_/fr/layout`, matches nothing, and
**reports success**. Rule 9C has been amended to say this; the tags of any built
page can be read from `.next/server/app/<path>.meta`.

### Validation

- 1024 unit and integration tests pass.
- Five new end-to-end tests in `tests/e2e/settings-admin.spec.ts`, each of which
  flips a control in the workshop and then goes and looks at the **public site**:
  the renamed shop in a page title, the curtain seen by a stranger in a second
  browser context, sign-in still reachable behind that curtain, the verification
  nag gone from a customer's account, and a 200 % deposit refused with nothing
  written.
- The spec runs in its own Playwright project, chained behind `content-admin`,
  because these rows are global and a test that closes the shop takes any spec
  running beside it with it.

### Deliberately not done

- **No secrets on the screen.** `is_secret` rows are not in the catalogue; an API
  key belongs in the environment, where rotating it is not a database write.
- **No preview of a closed shop**, as above.
- **No middleware gate.** It would keep both the cache and the staff exception,
  and it costs a database read plus a session lookup on every request. Recorded
  in ADR-038 as the alternative to revisit, not as an omission.

---

## TASK-026: Phase 14.11 — One size, once, and a checkout with nothing spare

Status: DONE

Related docs: `docs/ROADMAP.md` Phase 14.11

### What was asked

> "bruh there is somthings that we dont nee on the checkout ( yeah there are some
> fixed sizes but allow custome sizes and u only have to check the size if there
> is no custome one and only once pls ) and do some polishing for all the website
> becvause im going to propose for client"

The owner chose which fields to drop (the e-mail address and the note) and which
three surfaces to polish (the admin workshop, the custom builder, the
storefront's first impression).

### What was built

- **The size is asked once.** A custom size given in the placement editor *is*
  the size. The fixed bands are offered only when there is no custom one, and
  nothing asks again at checkout.
- **`orders.contact_email` is nullable**, with an `orders_contact_email_not_blank`
  check so the column holds an address or nothing, never an empty string. The
  customer notification returns early rather than failing when there is no
  recipient. A shop whose customers order over WhatsApp should not refuse an
  order for want of an address.
- **The note field is gone.** A free-text box nobody reads is a promise the shop
  does not keep.
- Polish across the three named surfaces.

### Worth remembering

The integration tests passed through a loophole while this was being built: they
submitted configurations with **no size at all**, which the new "ask only if
missing" logic read as "already answered". Fixed by giving the fixtures a
`sizeMm`. A test that proves a branch by never entering it is worse than no
test.

---

## TASK-025: Phase 14.10 — Visual placement

Status: DONE

Related docs: `docs/ROADMAP.md` Phase 14.10, ADR-035, ADR-036

### What was asked

> "when trying to order a custome in the placement section i want it to place it
> exactly where i want like i upload the image and put it on top of the hoodie
> totbag or whatever … and then the customer uploades the image and start
> hovering with it so he put it exactly where he wants it and them he submit also
> the size he's be resposnible for the size from there also"

Three questions were put to the owner, who chose: **true 3D** as the direction,
**pure freeform** placement rather than named positions, and **the box on the
photograph is the size**.

Then, with four garment photographs:

> "btw the final result of the placement should appear on the admin side"

### What was built

- A placement editor over a photograph of the garment: drop the artwork, drag,
  scale, rotate, switch between front and back. Pointer, touch and keyboard, and
  the artwork cannot leave the printable area.
- **A transform in texture space** — `x`, `y`, `width`, `rotation`, all
  percentages, `x`/`y` being the centre, height derived from the artwork's own
  aspect ratio — so one number positions a design over a photograph *and* inside
  a 3D model's UV map. ADR-035.
- **Millimetres derived server-side** from `product_images.surface_width_mm`,
  which only the workshop can set. A millimetre figure from a browser is a price
  the browser chose.
- **`PlacementPreview`**, which composites the customer's artwork over the same
  photograph on the request, the quote and the order — so the person at the
  machine sees what the customer saw.
- **A `.glb` parser and a second public prefix, `models/`**, refusing any model
  that names a resource outside itself. ADR-036.

### Still open

- **The 3D viewer itself.** Needs a `three` dependency and a real `.glb`. The
  parser, the prefix and the transform are all built and tested.
- **The admin's model-upload card.** The server actions exist; the screen does
  not.
- **More garment photography.** Four exist (hoodie front and back, t-shirt front
  and back). A tablier, a bonnet, a tote, a casquette, a polo and a black hoodie
  would cover the rest of the catalogue.

### Worth remembering

Three bugs here had the same shape — a display path that read a field the new
code no longer wrote:

- The placement was invisible until the quote was sent, because
  `summariseConfigurations` read only `placementLabel`; it now falls back to
  `designSurfaceLabel`.
- `finaliseUpload` reported no dimensions, because the promoted record was
  returned without spreading the inspection's `width` and `height`.
- `db:seed` clobbered the uploaded photographs, because its rows were keyed by
  position; it now skips any product that already has a `media/` image.

And one that was not a bug in this codebase at all: Next's image optimiser kept
serving the old bytes for an overwritten path. `rm -rf .next/cache/images`.

---

## TASK-024: Phase 14.9 — Archiving, and multi-select in the workshop's lists

Status: DONE

Related docs: `docs/ROADMAP.md` Phase 14.9, `docs/DATABASE.md` sections 1, 8, 9,
10 and 11, `docs/BUSINESS-RULES.md` section 12, ADR-034

### What was asked

> "for the admin page i cant find a way to delete the orders or request or
> whatever can u do that and maybe in the tables add multiple select so i can
> delete alot in one click"

and, immediately after:

> "maybe not delete jsut archive"

The second message is the design. A delete button on a list of orders is a shop
that can erase the record of money it took; the customer's own order page would
404 on a link they were e-mailed, and `ON DELETE SET NULL` would quietly orphan
whatever pointed at the row — which is exactly the mess Phase 14.6 spent a day
undoing. Archiving gives the owner what they actually wanted, which is an empty
queue, and costs nothing if they change their mind.

### What archiving means

**The row is hidden from the workshop's screens and from nothing else.** The
customer still sees their order, the record is intact, the relations are
untouched, and restoring is one click. Four tables carry `archived_at`
(`orders`, `custom_requests`, `quotes`, `reviews`), each with a partial index on
`WHERE archived_at IS NULL` — the half that is read — and a plain index on the
half the archive view lists.

Products are the exception and get no column: a product already archives through
`products.status`, which is customer-facing, so the catalogue's existing
`Archivé` filter *is* its archive view. A **published** product is refused from a
checkbox — archiving it would take a live product off the shop with no more
ceremony than tidying a queue — and restoring one returns it to `DRAFT`, never
to the shop.

### The selection

One component, `components/admin/bulk-archive`, wraps a list and gives it a
checkbox column, a header box scoped to the table it sits in, and a bar that
appears with the count and one button. Three details are load-bearing:

- **The selection is held by row id**, so it survives the `router.refresh()`
  that follows a write, and it is intersected with the ids on screen so a row
  that has left cannot be sent again.
- **A row checkbox needs `relative z-10`.** `TableRowLink` stretches over the
  whole row with `after:inset-0`; without the lift, the link takes the click and
  navigates instead of ticking the box.
- **The bar is `sticky`, not `fixed`.** A fixed bar covers the last row of the
  table, which is the row somebody is most likely to be about to tick.

A hundred rows per act (`MAX_BULK_ARCHIVE`): the lists page at fifty, so that
covers "select everything on two pages" and refuses a payload no sequence of
clicks could have produced. Each batch writes one audit row with the ids in its
metadata.

### What else moved

The payment screen follows the lists rather than the ledger: `/admin/payments`,
its six facet counts and the outstanding total all exclude archived orders, so
the figure agrees with the list printed beneath it. The facets go through a
single wrapper so a facet added later cannot forget the clause — `all` returning
`{}` was exactly the shape that would have listed archived orders silently.

The dashboard needed no change: its queues call the same list functions, which
now default to the live half.

### Deliberately not done

- **No automatic archiving after N days.** A queue that empties itself loses
  things; the workshop decides what it is done with.
- **No bulk anything else.** The bar archives and restores. Changing statuses,
  sending e-mails and editing prices are decisions with consequences and they
  keep their own screens.
- **No archive for customers, gallery items or stock.** The customer directory
  is a directory rather than a queue; the other two are Phase 12's outstanding
  half.
- **Reports and exports, when they exist, will count archived rows.** That is
  the same property that keeps the books honest.

### Fixed on the way

- **`ToastProvider` had never been mounted outside its own showcase.** The
  primitive has existed since the design system; the first screen to call
  `useToast` threw at render, which is by design — a confirmation that silently
  fails to appear is worse than a crash. It is now in the workshop's root
  layout, which is where a bulk action's "4 éléments archivés" belongs.
- **A locator in the catalogue's E2E suite was matching two cells**, because
  every row now carries a checkbox named after the product. It asserts on the
  row's link instead, which is the thing it goes on to click.

### Validation

- `prettier --check`, `tsc --noEmit`, `eslint` — clean
- `vitest run` — 933 tests green, including the new archiving domain suite and
  the archive integration suite
- `playwright test` — 165 green, including a new `archive-admin` project
  sequenced after `chromium` because it puts rows in the shared request queue
  and takes them off again
- `next build` — clean

---

## TASK-023: Phase 14.8 — Photographs, the CMS, the bilingual admin, Bizeora

Status: DONE

Related docs: `docs/ROADMAP.md` Phase 14.8, `docs/SECURITY.md` section 6,
`docs/ARCHITECTURE.md` sections 4 and 9, ADR-027, ADR-030, ADR-032, ADR-033

### Photographs

Eight per product, uploaded from the product screen: several at once, reordered,
one marked as the main one, each with the alternative text a screen reader
announces. The upload is **not** the customer-file pipeline and the difference
is the point — customer artwork goes straight to a private bucket and is
verified afterwards, which is exactly wrong for a public one. Here the bytes
pass through the server, which decodes them, applies the EXIF orientation,
**drops the metadata** (a phone writes GPS coordinates into every photograph),
caps the longest edge at 2400px and re-encodes as JPEG. Only then is anything
written where the world can read it.

The integration test asserts the part that matters: the bytes on the shelf are
**not** the bytes that were sent.

`public/assets` keeps the placeholder photography, because Next serves a static
file before it consults a route — the two coexist and no row had to move.
`STORAGE_LOCAL_ROOT` now defaults to `./.storage` in the project rather than the
system temp directory, so a reboot no longer loses what the owner uploaded.

### The landing page

`/admin/content` does what ADR-027 promised in Phase 13 and never had a screen
for: reorder the bands, switch one off without deleting it, change every word in
both languages, upload the hero photograph, set how many items a grid shows, and
edit the promotional strip.

The editor's fields are **generated from a declaration** in
`domain/content/editing`: the hero declares an eyebrow, a note, a secondary
button and an image; the grids declare a count. The screen renders a control per
entry and the service refuses a value for a field the band type does not
declare. A JSON config column and a form stay in step only if one of them is
derived from the other.

English is an overlay inside each row's own `config`, exactly as the seed writes
it, so the editor and the seeded content use one mechanism.

### The workshop, in two languages

Every admin screen now reads from the dictionaries. The language is the
`NEXT_LOCALE` cookie rather than a path segment: `/admin` is bookmarked, behind
a session and indexed by nobody, so a prefix would cost the bookmarks and buy
nothing (ADR-033). The server reads the cookie once in the workshop's root
layout and passes it to `<html lang>` and to a provider; `useDictionary` prefers
that provider and falls back to the pathname, so one hook serves both halves of
the application.

### Bizeora

The placeholder is gone. `src/config/brand.ts` was built for this day, so the
name, the wordmark, the titles, the e-mail sender, the social cards and the
legal name changed in one file. The logo the owner supplied is the favicon and
sits in the footer on a light chip — it is a 150 × 150 raster on solid white,
and a bare white square would read as a broken image on the dark palette.

### What this phase fixed on the way

**Cache invalidation had been dead since Phase 14.7.** Every admin write called
`revalidatePath('/shop')` and `revalidatePath('/')`, and since the storefront
became bilingual its paths are `/fr/shop` and `/en/shop`. The route-pattern form
(`'/[locale]/shop', 'page'`) does not reach a page nested in two route groups
either — I checked, against a real production build, rather than assuming. The
fix is one concrete path per language, and the landing-page editor's own tests
now prove that an edit reaches the front page instead of waiting five minutes.

### Deliberately not done

- **A page builder.** The bands are designed layouts with accessibility
  contracts; the editor changes their order, their words and their images.
- **The banner strip in two languages.** `banners` has one `message` column and
  no JSON to hang an overlay from; translating it is a migration.
- **Server-action messages in English.** They are produced where there is no
  request locale to read.
- **Category management and gallery curation** — still Phase 12's outstanding
  half.

### Validation

`prettier`, `tsc --noEmit`, `eslint`, 904 unit and integration tests, 161
Playwright tests across four projects, and `npm run build` — all pass. The
landing-page editor runs in a **project of its own that waits for the rest**:
its tests edit the front page every other spec reads, and in parallel they made
the storefront fail for a reason that had nothing to do with the storefront.

---

## TASK-022: Phase 14.7 — French and English, light and dark, photographs

Status: DONE

Related docs: `docs/ROADMAP.md` Phase 14.7, `docs/ARCHITECTURE.md` section 4,
`docs/DESIGN-SYSTEM.md` section 15, `docs/PRODUCT.md` locale assumptions, ADR-030, ADR-031

### The language is in the URL

Every public page is `/fr/…` or `/en/…`. A visitor with no preference is sent to the language their
browser asks for — French unless English is genuinely preferred — and the choice is remembered in
`NEXT_LOCALE`, so a bare internal link keeps it. The switcher in the header swaps the prefix and
keeps the rest of the path, so changing language on a product page lands on that product rather
than on the homepage.

The alternative — a cookie and one set of URLs — was rejected because it makes one address mean two
pages: a crawler indexes whichever it was served, and a customer cannot send a link in the language
they were reading.

The storefront moved under `(site)/[locale]/`, and the workshop moved into `(workshop)/`. There is
no `app/layout.tsx` any more: two root layouts, because `<html lang>` genuinely differs and a
shared root could only be right about one of them.

### The homepage speaks both, too

The bands are rows (ADR-027), and rows have one column per field rather than one per language.
Rather than a migration for a table that has no editor yet, each row carries its English copy
inside its own `config`, under an `en` key, and `domain/content`'s `localiseSection` merges that
over the French before the page renders. A band that says nothing in English keeps the French,
which reads better than a gap. The definitions moved out of `seed.ts` into
`prisma/homepage-sections.ts`, because the seed's entry point runs on import and anything wanting
to read that list would otherwise re-seed the database by asking.

### The words are typed

`dictionaries/fr.ts` is the source of truth and the type; `en.ts` is annotated with it. A key added
to French and forgotten in English does not ship a missing sentence — it fails the build. Three
runtime checks sit beside that: every French key has an English one, no English value is still its
French original (with an explicit list of the fifteen words that are the same in both), and no
`domain/` label map holds a status the storefront cannot name.

Two mechanisms carry the locale, and neither is a prop:

- **`Link`** prefixes a string `href` from the current pathname, so sixty call sites kept writing
  `href="/shop"`.
- **`useDictionary()`** reads the same pathname, so a form, a dialog or a badge needs nothing from
  its parent.

Both fall back to French outside a locale, which is what the workshop is.

### The theme is one set of tokens

Each token names its light and its dark value on one line, with `light-dark()`. There is no second
palette to keep in step, so a token cannot be added to one theme and forgotten in the other. The
system preference works with no JavaScript at all; the toggle stamps `data-theme` and an inline
script applies it before the first paint.

Dark mode found fifteen components that had hard-coded an inversion — `bg-fg text-fg-on-dark`
renders light-on-light when `--stitch-fg` is already light — and one accessibility failure: muted
sidebar headings were `opacity-60` over a light-on-dark colour, which measures 3.1:1. Four tokens
were added, and `DESIGN-SYSTEM.md` now forbids opacity as a way to mute a colour.

### The images have somewhere to come from

`toPublicAssetUrl` returned `null` for the whole of V1, because there was no public origin. There
is one now: `NEXT_PUBLIC_PUBLIC_ASSET_URL` accepts a root-relative path, `public/assets` is served
at `/assets`, and pointing that variable at a CDN later moves the whole folder without a code
change.

The 17 files in place are placeholders and say so on their face. `public/assets/README.md` records
the folder layout, the file names each product and gallery item resolves to, and the sizes a real
photograph should be. The homepage hero renders the configured image full-screen behind a
two-gradient scrim, and falls back to the previous split layout when there is none.

### Deliberately not done

- **The homepage's bands are translated; the catalogue is not.** Each `homepage_sections` row
  carries its English copy inside its own `config`, under an `en` key, and `localiseSection` merges
  it — no migration, and a band that says nothing in English keeps the French. Rows with no such
  column stay single-language: product names and descriptions, gallery captions, placements,
  thread colours, and the banner strip along the top. Translating those is a schema change — a
  translations table or a JSON column per locale — recorded in `PRODUCT.md` rather than
  half-built.
- **Server-action messages are French in both languages.** They are produced where there is no
  request locale to read.
- **The workshop is French and light.** Its dark pass is still on Phase 12's outstanding list.
- **The photographs are the owner's to supply.** Nothing invented is presented as a photograph of
  the business's work.

### Validation

`npx tsc --noEmit`, `npx eslint src tests`, `npx prettier --check`, 893 unit and integration tests,
152 Playwright tests across three projects, and `npm run build` — all pass. The E2E browser now
declares French (`playwright.config.ts`), because a default Chromium asks for `en-US` and would
land every French assertion on the English site; `tests/e2e/i18n.spec.ts` is the other half, and
audits English and the dark palette with axe.

Two integration tests were failing before this phase began, for a reason unrelated to it: Phase
14.5's admin verification had stocked the three variants the catalogue tests expect to be sold out.
They were returned to zero through the stock service, so the ledger records the correction.

---

## TASK-021: Phase 14.6 — Database hygiene, payment screen, end-to-end validation

Status: DONE

Related docs: `docs/ROADMAP.md` Phase 14.6, `docs/UX.md` section 9, `docs/DATABASE.md` section 14,
`docs/BUSINESS-RULES.md` 8.8 and 10.4.1, ADR-012

### What the database looked like

Forty-four accounts, 179 orders, 93 custom requests, 632 carts, 319 design files and 6 013 storage
objects — against a catalogue of 8 seeded products.

The classification turned on one fact: **the seed creates no users at all.** So every `users` row
was either an E2E fixture (`…@example.invalid`, all forty created on one day) or an account
somebody made by hand through the application. And the E2E teardowns had been deleting their users
while the foreign keys are `ON DELETE SET NULL`, which is why 174 orders had no owner and an
`…@example.invalid` contact address: the fixtures were not left behind, they were *orphaned*.

### What was removed, and what was kept

Removed: 40 fixture accounts, 179 orphaned orders, 88 requests, 645 carts, 315 design files, 131
notifications, 171 unreferenced customisation configurations, 126 expired verification rows, and
6 169 storage objects that no surviving row referenced. Nothing was removed for looking odd; the
storage sweep read its reference set out of the database rather than inferring it from filenames.

Kept: every reference and seed row — wilayas, zones, rates, tiers, settings, categories, products,
variants, options, placements, sizes, thread colours, fonts, profiles, homepage sections, gallery —
and **the four hand-made developer accounts with everything they own**. One of those is the only
`ADMIN` in the database; deleting it would have locked the owner out of `/admin`. They are
ambiguous by the phase brief's own test, so they were reported rather than guessed at.

The seed was **not** changed to hide any of this. It was changed for one unrelated reason, below.

### The payment screen

`/admin/payments` showed nothing. The data was there and correct — the repository, the DTO, the
authorisation and the customer relationships were all fine — and the screen still greeted the
morning bank check with "Rien dans cette file" while two orders owed 105 800 DA between them.

Two faults, both in the page:

**It opened on the justificatif queue.** A proof exists only when a customer has uploaded a
transfer receipt, which never happens in a shop whose default method is payment on delivery. The
first impression of the screen was therefore an empty state, permanently.

**"Acompte attendu" filtered on `status = AWAITING_PAYMENT`.** A deposit is a question about money,
not about an order status, and an order sitting in `AWAITING_CONFIRMATION` with an untouched
deposit — the commonest shape here — matched nothing.

The fix moved the queue into `order-repository`: `listOrdersForPayments`,
`countOrdersByPaymentPosition` and `outstandingAcrossOrders`. Facets are answered **in SQL** from
`paymentStatus`, which 8.8 derives from the payment rows and stores; the counts behind the tiles
run over the whole table rather than over the fetched page; and `outstanding` and
`outstandingDeposit` come from `domain/order/payment` rather than being arithmetic repeated in a
component, which the page had been doing. The default is now every order, and a payment-method
filter was added. No payment rule, status or amount changed.

### Two defects the journey found

**Delivery was charged at a hundredfold rate.** The first order placed in the journey came to
66 400 DA: 6 400 DA of caps and **60 000 DA of postage**. The seed wrote shipping rates as centimes
— its own comment said so — while product prices in the same file are whole dinars, and
`components/commerce/price` renders the stored integer with zero fraction digits. So the two halves
of the seed disagreed about the unit and the storefront rendered both the same way. This is the
concrete form of the ADR-012 naming discrepancy Phase 14 recorded as open. Fixed as data: the
placeholder rates are now 600/400, 750/550 and 1 100/850 DA, the unit is stated beside the column
in `DATABASE.md` section 14, and three integration assertions that pinned the old numbers were
updated. No pricing code changed.

**The confirmation screen contradicted the upload the customer had just watched succeed.** After
submitting a request with a design file — validated, stored, and returned as a server-generated
preview — the builder said "if you attached a file we will ask you for it again by e-mail: uploading
from the site is coming soon". Stale copy from before Phase 9 shipped the pipeline, unconditional,
never revisited. Now it says the file is attached and the workshop can see it.

### The controlled dataset

Two synthetic accounts, both created through `auth.api.signUpEmail` — the same call the HTTP route
makes — and the customer verified through `auth.api.verifyEmailOTP` with the code read from the
development memory transport. **`email_verified` was not written by hand.** There is no screen for
entering a verification code (recorded as outstanding since Phase 3.1), so a browser cannot complete
that flow; the transport is the legitimate development mechanism and it is what the auth tests
already use.

The journeys, both driven through the interface:

- **Stock product** — shop → variant → cart → checkout → `CMD-2026-5026`, 2 × Casquette brodée
  (Noir encre) at 3 200 DA, 600 DA delivery, 7 000 DA total, COD, `AWAITING_CONFIRMATION`. The
  reservation was taken at placement (10.4.1): `CASQUETTEBR-NOI` went from 0 to 2 reserved, 18
  available.
- **Custom embroidery** — builder with a real PNG upload through the Phase 9 pipeline (`READY`,
  with a server-generated preview), request `DEM-2026-11347` at `FIXED` pricing, staff took it into
  review, priced and sent quote `Q-8286`, the customer accepted and completed the quote-bound
  checkout → `CMD-2026-5027`, `AWAITING_PAYMENT`, CCP, total 14 400 DA and **deposit 7 200 DA
  copied from the quote, not recomputed**. The line is `CUSTOM`, `requiresProduction`, linked to
  the configuration and the quote item, carrying its own name, SKU, variant and price snapshots.
  The tote bag is `MADE_TO_ORDER` and an order entering `AWAITING_PAYMENT` reserves nothing, so no
  stock moved — correct on both counts.

Both orders appear on `/admin/payments`, the custom one under *Acompte attendu*. The customer portal
shows both; another customer's order, quote and request each return 404; a customer visiting
`/admin/payments` is sent home rather than told the area exists.

### Kept, not cleaned

Option A from the brief: the journey stays. Seven orders, eight requests, six quotes, three
payments, thirteen design files and twenty-six storage objects remain — the developer's own
exploration plus this phase's two journeys — so the application can be opened and looked at with
real records in it. Zero disposable rows remain by every pattern the inventory checks.

### Known limitations, unchanged

- **No screen for entering a verification code**, and none for password reset. Outstanding from
  Phase 3.1 and the reason this phase verified through the auth API.
- **`depositWindowDays` is still a placeholder**, so the payment screen shows waiting time and
  never claims a deadline.
- **Shipping rates remain placeholders** — the correct *unit* now, but not the owner's commercial
  numbers. Open decision 5.
- **The E2E teardowns orphan rather than cascade.** They delete their users and leave the orders
  behind with a null owner. That is what filled this database, and it will fill it again; the
  cleanup script's classification is recorded here so the next sweep is five minutes rather than an
  investigation.

### Validation

Format, lint, typecheck, **882** unit, integration and component tests (34 files), **142**
Playwright tests, the production build, five architecture probes, and a fresh-database replay —
`migrate deploy` from empty, seed twice, `migrate diff` reporting no difference, and the full suite
against it. All pass. The scratch database was created and dropped; the development database was
never reset.

---

## Previous

**Phase 14.5 — Redesign and admin operations. Complete.**

Two things were wrong at the end of Phase 14, and they were not the same kind of thing.

The **look** was a first draft that had never been revisited. The direction written in
`DESIGN-SYSTEM.md` was right — near-black actions on a warm ground, one accent, typography carrying
the hierarchy — and the execution had drifted: a ramp so warm it read as a sepia filter, an accent
close enough to the neutrals to stop being an accent, a homepage hero that was a band inside the
page's rhythm rather than the page's opening, and an admin built entirely from bordered cards. One
token the whole admin depended on, `bg-sunken`, had never been declared at all, so every "you are
here" highlight and the admin's own background compiled to nothing.

The **capability** gap was larger. The workshop could not add the thing it sells. Every product in
this shop arrived from `prisma/seed.ts`, and there was no screen anywhere that created one, priced
one, gave it a SKU or recorded that six of something had been received. That has been listed as
"Phase 6's unfinished half" since Phase 6 and was never anybody's phase.

Both are now done, and the second one is the reason this phase needed a schema change and an ADR.

---

## TASK-020: Phase 14.5 — Redesign and admin operations

Status: DONE

Related docs: `docs/ROADMAP.md` Phase 14.5, `docs/DESIGN-SYSTEM.md` sections 1, 4, 7, 12 and 15,
`docs/UX.md` section 9, `docs/BUSINESS-RULES.md` 10.10 and 12.1, `docs/DATABASE.md` section 5,
ADR-029

### Delivered — the visual system

- **`styles/tokens.css` rewritten below the semantic layer.** The ink ramp cooled and lost its brown
  cast, the paper grounds moved to bone, the accent moved from ochre (`#9a4e26`) to madder
  (`#8a3623`), status colours desaturated, and the radii flattened (`md` 4 → 3, `lg` 8 → 6).
- **Three surface roles and a third border weight added**: `bg-sunken`, `bg-inverse`,
  `surface-inverse`, `hairline`, plus `fg-on-dark-muted`, `fg-on-accent` and `border-on-dark`.
  Nothing above the token layer needed editing to pick them up, which is the property the semantic
  layer exists for.
- **New primitives**: `components/ui/table.tsx` (a real `<table>` that folds into labelled blocks
  below `md`), `page-header.tsx` (`PageHeader`, `FilterBar`, `FilterLink`), `stat.tsx` (`StatGrid`,
  `StatTile`), and `NativeSelect` in `input.tsx`. `Badge` gained five status tones; `SelectField`
  gained `name` so it can live in a form.

### Delivered — the storefront

- **A full-viewport hero**, full-bleed, type on paper and the image panel running to the edge,
  built to receive a real photograph without being redesigned. Inside the existing
  `homepage_sections` architecture (ADR-027): the band is the same row type it always was.
- **The closing call to action is the page's one inverse band.** The mid-page one stays on paper —
  two black bands is a stripe pattern.
- **The shop has a masthead** rather than a page title, with the count on the same rule as the
  heading.
- **The product page's purchase panel is sticky** from `lg`, and the long description moved *below*
  it. Above it, a paragraph pushed the price and the button under the fold on a phone.
- **The account portal is a rail and a working area** from `lg` instead of a strip of six chips over
  a stacked page.
- **The builder's progress indicator** is markers on a filled rule with a step count, instead of
  five text buttons separated by middots.

### Delivered — the admin

- **A grouped sidebar** on the inverse ground, a real drawer below `lg`, and a working area that is
  full width to 1400px instead of a centred 1200px document column.
- **Every list is a table**: dashboard queues, orders, requests, quotes, customers, payments,
  products, stock. Below `md` the same markup stacks, with each cell printing its own column
  heading from `data-label` and the `<thead>` `sr-only` so the structure survives for a screen
  reader.
- **The dashboard** is four queue-length tiles over six tables in priority order. Still no revenue
  figure and no chart.
- **`/admin/payments`** — new. Phase 12 built the payment operations inside individual order
  workspaces, which is the right place to *do* them and the wrong place to *find* them.
- **`/admin/products`** and **`/admin/products/new`**, **`/admin/products/[productId]`** — new.
  Create, edit, rename, publish, archive; options, values, variants, SKUs, price overrides,
  thresholds, active flags.
- **`/admin/stock`** — new. One row per variant, filters for the two alert states, and an
  adjustment dialog.

### The three decisions worth recording

**Stock moves as a signed delta into an append-only ledger.** A quantity field on a variant form
races every other write to that row — a form posting "the new total is 12" discards the shipment
that went out while the page was open — and leaves no record of who set it or why. So the form posts
`-3`, the database does the arithmetic, and `inventory_adjustments` records the movement, the
reason, the resulting quantity and the person, in the same transaction. ADR-029 has the full
argument, including why `audit_logs` was the wrong home.

**The two stock invariants live in the `UPDATE`'s own `WHERE` clause.** Stock cannot go negative and
cannot drop below `reserved_quantity`, and both are conditions on the write rather than checks
performed a moment earlier against a value that has since moved. `domain/catalogue` checks the same
two conditions to produce the *message* an operator reads — "3 unités sont réservées à des commandes
en cours" — and the row is what makes them true.

**Renaming a product finally writes `product_redirects`.** Phase 14 read that table and recorded
that nothing wrote to it, because the screen that renames a product did not exist. It does now, and
the rename and the redirect happen in one transaction: a rename that lost its redirect is a 404 on a
URL somebody has already linked to, and the old slug cannot be reconstructed afterwards.

### Defects this phase found and fixed

**`bg-bg-sunken` was a dead class in eight components.** Tailwind compiles an undeclared colour
utility to nothing, silently. The admin shell had no background and every current-page highlight in
the admin nav, the account nav and the order filters was invisible. Latent since Phase 12.

**The sidebar's group headings failed AA.** `text-fg-on-dark` at 60% opacity measured 3.1:1; axe
caught it. Replaced with `fg-on-dark-muted`, and `DESIGN-SYSTEM.md` section 4 now forbids expressing
a muted colour as an opacity — a token is a colour somebody chose and can check.

**A `'use server'` module may only export async functions.** The form-state constants exported from
`admin/products/actions.ts` built without complaint and then were not the objects the client
imported, so `/admin/products/new` rendered nothing usable. Moved to `products/form-state.ts`.

**A file-scope Playwright `afterAll` runs once per worker, not once per file.** A teardown matching
`e2e-cat-%` deleted the account another worker was signed in as, which surfaced three tests later as
a redirect to `/login` and looked exactly like an authorisation bug. Teardown now deletes the rows
that worker created, by name.

### Deliberately not built

- **Product image upload.** There is no public asset bucket: `lib/storage` declares only the private
  prefixes (`quarantine`, `designs`, `previews`), and `toPublicAssetUrl` returns `null` until an
  origin is configured. Adding an upload here would put marketing photography in the private
  customer-file bucket, which the storage boundary forbids. The product page says so, in place,
  rather than offering a control that cannot work. **Blocked on Phase 9's unprovisioned bucket.**
- **Category management.** Products need a category and the seeded ones are the only ones there are.
  The create form says so when the list is empty rather than failing at the foreign key.
- **Deleting a variant or a product.** Both are deactivated or archived instead, because
  `order_items` reference them and losing the reference loses the ability to open a product from a
  past order. Historical snapshots are untouched either way (ADR-010, ADR-016).
- **Bulk stock import, stock takes, purchase orders, suppliers.** ADR-029 deliberately built the
  smallest ledger that makes a manual change safe, and no inventory architecture beyond it.
- **Everything else in Phase 12's outstanding half**: gallery curation, content and settings
  screens, the audit-log viewer, admin dark mode (the tokens exist; no toggle is built), and the
  guest half of the customer directory.
- **Storefront search, filters, sorting and pagination**, and `/shop/c/[category]`. Still Phase 6's
  unfinished half; this phase redesigned what exists rather than adding surface.

### Known limitations

- **`listStockRows` is bounded at 400 variants and filters the two alert states in JavaScript.**
  "Low" compares `stock - reserved` against a per-variant threshold with a constant fallback, which
  is a domain rule; restating it as SQL would be a second copy that could drift. It is correct and
  it will need an index-backed query long before 400 variants becomes 4,000.
- **The product list is capped at 50 rows with no pagination.** Search covers name, slug and SKU,
  which is what the workshop actually reaches for; a page control belongs with the one the
  storefront still does not have.
- **The admin's variant editor cannot change a variant's option combination** once created. It can
  change the SKU, the price override, the threshold and the active flag. Changing which size a
  variant *is* is a different operation from editing one, and it was not needed.
- **`depositWindowDays` remains a placeholder**, so `/admin/payments` shows how long an order has
  been waiting and never claims a deadline.

### Still unowned by any phase

Unchanged, and repeated because it is easy to lose: **`/faq`, `/about`, `/how-it-works`,
`/size-guide`, `/care-guide`, `/privacy`, `/terms` and `/contact`** appear in `UX.md`'s sitemap and
are backed by the `pages` and `faqs` tables, and **no phase in `ROADMAP.md` claims them.** Somebody
has to assign them; this phase did not invent their ownership or their content.

### Validation

Format, lint, typecheck, the full Vitest suite, the full Playwright suite across three projects, the
four architecture probes, the production build, and a clean-database migration replay with the seed
run twice and `migrate diff` reporting no drift. Counts are in the phase report.

Accessibility: axe over `/admin`, `/admin/products`, `/admin/products/new`, `/admin/stock` and
`/admin/payments` in addition to the existing storefront coverage. Responsive: 375/768/1024/1440,
with an explicit no-horizontal-overflow assertion on the four densest admin screens.

---

## Previous

**Phase 14 — SEO. Complete.**

The storefront now describes itself to a search engine, and describes itself honestly. Every public
page carries a title, a description, an absolute canonical and a social card; the product pages
carry `Product`, `Offer` and — only when there are approved reviews — an `AggregateRating` built
from the same figures the page prints; `sitemap.xml` is generated from the repositories behind the
storefront's own visibility rules, and `robots.txt` keeps the application's surfaces out of a
search result.

One rule governs all of it: **a search engine is told exactly what a visitor is shown.** Structured
data that claims a rating no page displays, or a price that disagrees with the one in the cart, is
the single way this feature can do harm — so every builder in `domain/seo` omits a property rather
than filling it in, and the offer's price is formatted from the same integer, with the same number
of digits, that `components/commerce/price` renders.

Indexing itself is now one switch. `SEO_INDEXABLE` is off unless set: with it off every public page
is `noindex` and `robots.txt` disallows everything, which is what a staging copy should do. Phase
18 turns it on (ADR-028).

---

## TASK-019: Phase 14 — SEO and discoverability

Status: DONE

Related docs: `docs/ROADMAP.md` Phase 14, `docs/ARCHITECTURE.md` section 11A, `docs/SECURITY.md`
section 10, `docs/UX.md` section 2, ADR-028

### Delivered

- **`domain/seo`** — pure JSON-LD builders: Organization, WebSite, BreadcrumbList, Product with its
  Offer and optional AggregateRating, ItemList, and the serialiser that escapes `<` so a product
  name cannot close the script element it sits in.
- **`lib/seo`** — the only place a public URL is built, the robots directives, `publicPageMetadata`
  (one helper for title, description, canonical, Open Graph and Twitter), and `notFoundMetadata`.
- **`components/seo`** — the JSON-LD element and the drawn social card the image routes share.
- **`app/sitemap.ts`** — the four public routes plus every published product and gallery item, from
  the repositories, behind `publiclyVisibleWhere` and `publiclyVisibleGalleryWhere`.
- **`app/robots.ts`** — a written-out disallow list covering `/admin`, `/account`, `/cart`,
  `/checkout`, `/login`, `/register`, `/order`, `/dev` and `/api`.
- **Generated Open Graph images** — one site-wide, one per product carrying its name and price.
  There is no photography yet, so a shared link would otherwise be a bare URL; a product that *has*
  a photograph keeps the photograph, because Next uses the file-based image only when the page's
  metadata sets no image of its own.
- **Canonicals everywhere public**, absolute and from `NEXT_PUBLIC_SITE_URL`. Filtered gallery
  views canonicalise to `/gallery` and carry `noindex, follow`.
- **301 redirects from `product_redirects`** (11.6) — Next issues a 308, which search engines treat
  identically. The table has existed since the initial migration with nothing reading it.
- **`SEO_INDEXABLE`**, the deployment-wide switch, documented in `.env.example` and in ADR-028.

### Four things worth recording

**The price in the structured data had to be derived from the display, not from the column.**
`ADR-012` calls the money column "integer minor units", and `formatMoney` renders it with zero
fraction digits — so a stored `2500` is "2 500 DA" on the page. A schema price computed as
`minorUnits / 100` would have advertised every product at a hundredth of its price. `schemaPrice`
takes the same number of fraction digits the page formats with, so the two are the same value by
construction. The naming discrepancy in ADR-012 is recorded as open below; this phase did not
change how money is stored or shown.

**Omission is the whole discipline.** `aggregateRating` is absent from a product nobody has
reviewed rather than present with a zero; `sameAs` is absent when the page shows no social link; a
`BreadcrumbList` with no trail is no node at all; a `generateMetadata` that cannot find its row
returns no canonical. Every one of those is a test.

**A global canonical is a trap, and this phase set one for a few minutes.** Adding
`alternates: { canonical: siteUrl }` to the root layout gives *every* page without its own
canonical — including the 404 and the cart — a canonical pointing at the homepage. The end-to-end
tests caught it. The root layout now sets `metadataBase` and no canonical.

**The indexing switch is not access control, and the documentation says so where somebody would
look for it.** `robots.txt` keeps a private URL out of a search result; `server/auth/guards` is
what refuses the request. The two are independent on purpose.

### A defect this phase found outside itself

**Human identifiers wrapped at ten thousand.** `next_order_number()` and `next_request_number()`
formatted the sequence with `lpad(n::text, 4, '0')`, and PostgreSQL's `lpad` **truncates** a string
longer than the requested width — so the ten-thousandth request came out as `DEM-2026-1046` instead
of `DEM-2026-10464` and collided with a number already issued. The symptom is a unique-constraint
violation at the moment a customer presses "submit", which is the worst possible place for it.

Latent since Phase 8; surfaced because this phase's repeated end-to-end runs pushed the development
sequence past 9999. Fixed by migration `20260906210000_identifier_overflow`, which pads to
`GREATEST(4, length(n))` — `0005` stays `0005`, `10464` stays `10464`. `to_char(n, 'FM0000')` looks
like the obvious fix and is not: PostgreSQL renders `####` when a value overflows a numeric format,
which trades a truncated number for a meaningless one. ADR-023 now states the format grows, and the
end-to-end regexes that read a number off the screen were matching `\d{4}` and would have silently
captured the first four digits of a five-digit number.

**The site's `<title>` and meta description were in English** on a French interface
(`PRODUCT.md` section 6). `brand.tagline` and `brand.description` are the default title, the meta
description and the line under the logo in the footer and in every e-mail; they were written when
there was no `<head>` worth reading. Now French.

**The cart had a canonical and no robots directive** — the one public route still missing its
directive when this phase audited them.

### Deliberately not built

- **410 Gone for archived products.** `ROADMAP.md` lists it. The App Router cannot set a status
  code from a page component; it needs middleware or a route handler, and Prisma does not run in
  edge middleware. An archived product currently returns 404, which de-indexes it correctly if more
  slowly. Recorded as open rather than worked around with a fake status.
- **FAQPage structured data.** There is no `/faq` route to put it on — it is one of the storefront
  routes no phase owns (below).
- **Category URLs in the sitemap.** There is no `/shop/c/[category]` route to list; it is Phase 6's
  unfinished half, and it is why the homepage's `CATEGORY_GRID` band ships disabled.
- **A Lighthouse score.** Lighthouse cannot score SEO on a deployment that asks not to be indexed,
  and this one does until Phase 18 sets `SEO_INDEXABLE`. The roadmap now names it as a launch-time
  check.
- **Analytics, Search Console, keyword tooling, an SEO dashboard.** Phase 18 connects analytics and
  Search Console; the rest is not in V1 at all.

### Known limitations

- **No photography, so no real Open Graph image.** Every card is drawn. A product with a photograph
  would use it; none has one until the public asset bucket exists.
- **`product_redirects` is read but never written.** A slug change writes a row (11.6) — from the
  admin catalogue management Phase 6 has not built. The read is correct and tested against a row
  inserted by hand.
- **The sitemap is generated per request** rather than at build time, because the project keeps the
  database out of `next build`. It is bounded at ten thousand URLs per type.
- **`ADR-012` calls the money column "minor units" and the application treats it as whole dinars.**
  The display and the structured data now agree with each other and with the cart, so nothing is
  wrong today; but the ADR and the code use the same words for different things, and the day a
  currency with subunits is added, that has to be resolved first. Not this phase's to change.

### Still unowned by any phase

Unchanged from Phase 13, and repeated here because it is easy to lose: **`/faq`, `/about`,
`/how-it-works`, `/size-guide`, `/care-guide`, `/privacy`, `/terms` and `/contact`** appear in
`UX.md`'s sitemap and are backed by the `pages` and `faqs` tables, and **no phase in `ROADMAP.md`
claims them**. They are not in this phase's sitemap because they do not exist. Somebody has to
assign them; Phase 14 did not invent their ownership or their content.

### Validation

Format, lint, typecheck, **819** unit, component and database tests (31 files), **132** Playwright
tests across three projects, the production build, the four architecture probes, and a
clean-database migration replay with the seed run twice, `migrate diff` reporting no drift, and the
full suite run against it all pass. Counts are the final run's; the critical end-to-end flows were
re-run afterwards with the same result.

Accessibility: no visible content changed except the brand tagline in the footer, so the existing
axe coverage stands; `/`, `/shop`, `/gallery` and the product page were re-scanned as part of the
full Playwright run.

---

## Previous

**Phase 13 — Reviews, gallery, content polish. Complete.**

The storefront now has the two things a small workshop is actually judged on: proof that other
people bought from it, and proof of what it can make. A customer whose order has been delivered
writes a review from their account; the workshop publishes or refuses it, and the product's rating
is recomputed in the same act. "Our Work" lists the pieces the atelier has embroidered, filterable
by support and by type of embroidery, each one linking to the products it corresponds to.

And the homepage stopped being a component. It is `homepage_sections` rows now — eleven band types,
ordered by `position`, switched by `isEnabled` — so changing the words on the front page or the
order of what is on it is an `UPDATE` (ADR-027).

Two rules govern everything this phase added. **An unapproved review is invisible**, and that
clause lives in the query rather than in a component that could forget. And **nothing on the front
page is invented**: the reviews band renders approved rows or disappears, and the delivery figures
in the trust band come from `shipping_rates` — the numbers the checkout charges.

---

## TASK-018: Phase 13 — Reviews, gallery and content

Status: DONE

Related docs: `docs/BUSINESS-RULES.md` 11A and 13.6, `docs/DATABASE.md` sections 11 and 13,
`docs/UX.md` section 2, `docs/SECURITY.md` sections 10 and 12, `docs/ARCHITECTURE.md` section 11,
ADR-027

### Delivered

- **`domain/review`** — pure: the review lifecycle's predicates (eligibility, moderation
  transitions), the draft validation with its length bounds, and the rating arithmetic. The average
  is an integer × 100 and is **null with no reviews, not zero**.
- **`domain/gallery`** — the consent predicate of 13.6, and the filter parsing and URL building.
- **`domain/content`** — the eleven section types, ordering, the per-type `config` readers (none of
  which throws), and the declaration of what data each type needs loaded.
- **`domain/permissions`** gained `mayModerateReviews`, `mayManageContent` and `mayWriteReview`, so
  12.1's rows for reviews and content stay pure predicates.
- **`server/repositories/{review,gallery,content}-repository`** — the read and write paths, with
  `status = APPROVED` and `isPublished` as clauses in the `where` rather than filters afterwards.
- **`server/services/review-service`** — submission (the payload names an order line and nothing
  else) and moderation (the rating recomputed inside the repository's transaction).
- **`server/services/content-service`** — the homepage's single load pass.
- **`/gallery` and `/gallery/[slug]`** — filterable by link, so a filtered view is a shareable URL,
  with related products joined on shared tags.
- **`/account/reviews`** — what you can review, and what you have written with its status.
- **`/admin/reviews`** — the moderation queue, filtered by state through the URL, with an optional
  public reply published alongside the verdict.
- **The product page** gained its rating summary, the distribution, and the approved reviews.
- **The homepage** is now composed from the content rows, including a trust band whose delivery
  figures are read from the shipping zones.
- **A migration** adding the gallery consent CHECK constraint, the published-gallery index and the
  moderation-queue index.
- **The seed** gained six demo gallery items, the eleven homepage bands carrying the copy that used
  to be hard-coded, six tags shared between products and gallery items, and one factual banner.

### Four things worth recording

**The consent rule is enforced twice on purpose.** `DATABASE.md` specified 13.6 as a service-layer
invariant asserted by test. It is now that *and* a CHECK constraint: publishing a gallery item made
from a customer's design without a recorded consent is the one mistake here that would end the
business rather than produce a bug report, and a rule that depends on a service remembering it is a
rule with one line of defence.

**Nothing about a review is taken from its payload except the words.** The action sends an order
line, a rating, a title and a body. The product comes from the line; the line is resolved with
`order.userId` in the query, so a foreign id is "not found"; `isVerifiedPurchase` is written from
the resolved delivered order; and the status is always `PENDING`. There is no path through the
service that publishes anything.

**The rating is recomputed, never adjusted.** Approving a review re-reads the product's approved
rows and writes the summary of them. An incremental `+1` would be faster and is how a denormalised
aggregate drifts from what it summarises with nothing to notice. The moderation is also a
**conditional** update on the status the moderator was looking at, so two moderators with the queue
open cannot both believe they decided.

**A band with nothing to show renders nothing.** No empty grid under a heading, no "coming soon".
A shop with no approved reviews has no reviews band; a `SOCIAL` band with no links is absent. This
is the same rule the homepage has followed since Phase 5 — no invented statistics, no testimonials
from customers who have not spoken — now enforced by the data rather than by a component's
restraint.

### The security boundary

- **Only approved reviews are public**, and the clause is in every public query. A pending review
  is a customer's unpublished words and a rejected one is words we declined to publish.
- **No identifier leaves with a review.** The public DTO carries a shortened display name
  ("Amina B.") and a date. No e-mail, no user id, no `moderatedByUserId`, no `moderatedAt` — a test
  serialises the whole panel and asserts none of them appears.
- **A review is rendered as text.** React escapes it; nothing on that path sets inner HTML.
- **No gallery DTO carries `sourceDesignFileId`, `imageKey` or `customerConsentAt`.** The public
  image is a separately uploaded asset resolved through the public origin; the private original is
  never served publicly, consent or no consent.
- **Every admin action authorises independently** — `requireStaff` and then the capability
  predicate over the loaded actor — because an action is reachable without a page ever rendering.
  A customer who types `/admin/reviews` is redirected home rather than refused, so the workshop's
  existence is not confirmed to them.
- **Content `config` is treated as data a person edits**: defaults for anything malformed, bounded
  limits so an edit cannot scan the catalogue, and icons through a closed allow-list.

### A defect this phase found outside itself

**A navigation test's allow-list had gone stale.** `tests/components/storefront.test.tsx` asserted
that every header and footer link points at a route that exists, against a hand-written set of
three paths. Adding `/gallery` failed it — for the right reason in the wrong way, since the route
does exist. The set is now derived from the route files under `app/(storefront)`, so it cannot go
stale again, and the assertion is stronger than it was.

**An accessibility defect in this phase's own first draft.** The gallery filter chips carried
`aria-pressed`, which a link's role does not allow — axe caught it. They are links, not toggle
buttons, so the attribute is `aria-current`. The admin's reply box lost its label to an `id` that
overrode the one `FormField` generates; both were found by the axe scans in the new end-to-end
specs rather than by review.

### Deliberately not built

- **Gallery curation, content management and settings screens.** `ROADMAP.md` puts all three in
  Phase 12's outstanding half, not in Phase 13. The storefront reads these rows; editing them is a
  database update until that half is built. This is the largest thing this phase leaves open, and
  it is where ADR-027 pays off.
- **Admin catalogue management, the audit-log viewer, admin dark mode and the guest half of the
  customer directory.** Also Phase 12's outstanding half. None of them is a Phase 13 bullet, and
  the brief for this phase is explicit that only the roadmap's Phase 13 scope is in scope.
- **`/faq`, `/about`, `/how-it-works`, `/size-guide`, `/care-guide`, `/privacy`, `/terms` and
  `/contact`.** The `pages` and `faqs` tables back them and `UX.md` section 2 lists them, but no
  phase in `ROADMAP.md` claims them. They are recorded as open below rather than built
  opportunistically.
- **A `CATEGORY_GRID` band on the live homepage.** The renderer exists and is tested; the band is
  seeded **disabled** because its cards lead to `/shop/c/[category]`, which Phase 6 has not built.
  A navigation link to a page that does not exist is a 404 dressed up as an affordance.
- **Seeded reviews and seeded social links.** A seeded review is fabricated social proof and a
  seeded profile URL is an account that does not exist. Both bands render nothing until there is
  something real, and both are exercised by tests that create their own rows.
- **Ratings analytics, recommendations, review voting or replies from other customers.** None is in
  V1.

### Known limitations

- **No photography.** Gallery items carry the object key a photograph *will* occupy; until the
  public bucket exists, `toPublicAssetUrl` resolves every key to null and the media primitives
  render their placeholder. The alt text is written properly, which is why it matters.
- **The gallery has no pagination.** It is bounded at 24 items, which is the page size the
  catalogue uses. A gallery larger than that needs the same pagination the shop is still waiting
  for.
- **A review cannot be edited or withdrawn by its author.** 11A does not describe either, and
  inventing a policy for it — does an edit return the review to `PENDING`? — is a business decision
  nobody has made.
- **A guest purchaser still cannot review** (11A.4). The documented mitigation is the claim flow,
  and the "create an account to review this order" prompt on the guest confirmation page is not
  built.
- **The storefront routes above have no phase.** `/faq` and the five `pages`-backed routes are in
  `UX.md`'s sitemap and in no phase's scope. Somebody should assign them.

### Validation

Format, lint, typecheck, **783** unit, component and database tests (28 files), **117** Playwright
tests across three projects, the production build, the four architecture probes, and a
clean-database migration replay with the seed run twice, `migrate diff` reporting no drift, and the
full suite run against it all pass. Counts are the final run's; the critical end-to-end flows were
re-run afterwards with the same result.

Accessibility: axe reports no WCAG 2.1 A/AA violations on `/`, `/gallery`, `/gallery/[slug]`,
`/account/reviews`, `/admin/reviews` or the product page with reviews. No horizontal overflow on
any of them at 375px.

---

## Previous

**Phase 8A — Transactional notifications. Complete.**

When something important happens, the person it happened to is told. A custom request reaches the
workshop, a quote reaches the customer who asked for it, an order confirms itself to the buyer and
announces itself to the workshop, and a quote about to lapse warns both sides once.

Two rules govern all of it. **The announcement is written in the transaction that caused it** — a
row in the outbox, never a provider call — so a provider being down cannot roll back an order and a
crash between the two cannot lose the message. And **the recipient is never an argument a browser
supplies**: a customer message goes to the address on the row that announced it, a staff message to
the `notifications` setting, and `domain/notification` declares each template's audience so the two
can never cross.

---

## TASK-017: Phase 8A — Transactional notifications and e-mail

Status: DONE

Related docs: `docs/ARCHITECTURE.md` section 11, `docs/SECURITY.md` section 2.1 and section 10,
`docs/DATABASE.md` sections 13 and 14, `docs/BUSINESS-RULES.md` 7.4 and 7.10, ADR-026

### Delivered

- **`domain/notification`** — pure and small: the eight templates, `TEMPLATE_AUDIENCE`,
  `dedupeKeyFor`, the retry curve, the two-day expiry-warning window, and recipient parsing. No
  provider, no rendering, no I/O.
- **`lib/email`** — a renderer (`layout.ts`) that emits table-based HTML with inline styles and a
  plain-text alternative for every message, eight typed templates (`templates.ts`), and one
  `EmailTransport` interface with three implementations chosen by configuration rather than by
  `NODE_ENV`: Resend when a key is set, memory under test, console otherwise.
- **`server/repositories/notification-repository`** — the only module that touches the table.
  Enqueue (swallowing the unique violation), skip with a reason, claim under a lease, mark sent,
  mark failed with a retry time, requeue, count by status. It re-exports `NotificationTx` and
  `NotificationPayload` under ORM-neutral names so a service can join a transaction without
  importing Prisma.
- **`server/services/notification-service`** — the eight events and the dispatcher.
  `notifyOrderPlaced`, `notifyRequestSubmitted`, `notifyQuoteSent`, `notifyQuoteExpiring`,
  `sendVerificationCode`, `sendPasswordReset`, `dispatchNotifications` and `runNotificationSweep`.
- **`POST /api/jobs/notifications`** — the scheduler's one door: bearer `JOBS_SECRET` compared in
  constant time, 503 when unconfigured, a summary in the response and never a recipient.
- **Hooks in the three transactions that announce something** — `onPlaced` on order placement,
  `onSubmitted` on request persistence, `onSent` on quote sending. Each is invoked inside the
  transaction it belongs to, so the row and the announcement commit together or not at all.
- **A migration** adding `notifications.dedupe_key` with its unique index, and seeding
  `notifications.adminRecipients` empty.
- **`RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFICATION_EMAIL` and `JOBS_SECRET`**, all optional,
  all documented in `.env.example` with the cron invocation.

### Four things worth recording

**The credential e-mails deliberately leave the outbox alone.** A verification code lives fifteen
minutes and a reset link one hour, and the outbox stores its payload in a durable table — so
queuing them would spend a third of the code's life waiting and would put live credentials in every
backup. They render and send inline instead. ADR-026 records the trade this buys and gives up: no
delivery record for those two messages.

**Claiming a row is a compare-and-swap, not a batch update.** The first implementation incremented
`attempts` across the batch and left `status` alone, so two dispatchers running at once both
claimed the same rows — a test with two concurrent sweeps sent four messages for two rows. It is
now a per-row `UPDATE … WHERE id = ? AND status = 'PENDING' AND scheduled_for <= now` that pushes
`scheduled_for` forward by a five-minute lease: the same primitive the order and quote transitions
use, and a dispatcher that dies mid-batch releases its rows when the lease lapses.

**Recipients are resolved before the transaction opens.** `enqueueStaff` originally read the
settings row itself. The connection pool is one connection wide (`ARCHITECTURE.md` 18), so a
settings query issued while an interactive transaction holds that connection waits for a
transaction that is waiting for it — about ten integration tests timed out at five seconds. The
recipients are now resolved by the caller and passed in, which is also the honest shape: an
announcement should not be doing configuration lookups.

**One bad row must not stop the queue behind it.** `renderEmail` threw on a payload that did not
fit its template and took the whole dispatch loop with it. It returns `null` now, and the
dispatcher treats an unknown template or an invalid payload as a failure with **no** retry —
neither becomes well-formed on its own, so the row is left `FAILED` where a person can find it
while everything behind it goes out.

### The security boundary

- **No recipient comes from a request.** A customer message goes to the row's own address: the
  order's stored `contactEmail`, the quote owner's account address read through
  `findQuoteOwnerContact`. A staff message goes to `notifications.adminRecipients`, with
  `ADMIN_NOTIFICATION_EMAIL` as a bootstrap for a deployment where nobody has opened the admin.
  With neither configured, a `SKIPPED` row is written so an undelivered event is visible.
- **A queued payload carries only what its recipient may read.** It is built from the snapshots the
  announcing row already holds, so `internalNotes`, a `storageKey`, an `/admin/` URL in a customer
  template, or another customer's data are absent by construction. A test asserts each.
- **No credential is stored.** `auth.verify_email` and `auth.password_reset` never reach the table
  (ADR-026), and a test asserts the outbox holds no row for either after a registration and a reset.
- **Nothing logs a body.** The console transport records the subject and recipient only; the
  provider transport stores the HTTP status in `lastError`, never the provider's error body.
- **The scheduler endpoint is `POST`-only behind a constant-time secret comparison**, refuses
  outright when unconfigured, and answers with counts.

### A defect this phase found outside itself

**Ten of the sixteen server environment variables were never read.** `lib/env` declared them in
its schema and then handed the parse a hand-written object listing six. Every missing one is
optional, so the result looked exactly like "not configured": `S3_*` would have been ignored in
production and storage would have silently used the local adapter, and the scheduler endpoint
answered 503 with its secret correctly set — which is how this was found. The raw object is now
derived from the schema's own keys, so the two cannot drift, and `tests/unit/env.test.ts` asserts
that every declared name arrives.

### Deliberately not built

- **The WhatsApp click-to-chat generator and the WhatsApp channel stub.** `ROADMAP.md` lists them
  under this phase; they are a manual admin convenience with no delivery path behind them, and
  building a registry entry that reports "not configured" adds a channel abstraction nothing uses.
  V1.5 owns templated WhatsApp delivery and can build both at once.
- **In-app notification records.** The table's `readAt` column is for them. Nothing renders a bell
  yet, and a written-but-unreadable row is a migration pretending to be a feature.
- **The `acceptanceValidUntil` warning.** `ARCHITECTURE.md` 11 lists it beside the `validUntil`
  one. The acceptance window is seven days and is enforced lazily on every read, and a second
  warning template on a second deadline is more mail than the flow warrants before anybody has used
  it in anger.
- **A retry-tuning surface, batching or digests.** `ARCHITECTURE.md` puts them in V1.5. The curve
  here is four fixed backoffs and no jitter.
- **An admin screen for the outbox.** `countNotificationsByStatus` and `requeueFailedNotifications`
  exist for an operator; the interface to them is Phase 13 or later, and inventing one now would be
  admin scope this phase does not own.

### Known limitations

- **A warning queued during a sweep goes out on the next one.** Dispatch uses the instant the sweep
  began, so it does not claim rows created after it. On a five-minute timer that is a five-minute
  delay on the expiry warning only; every other event is queued before the sweep that sends it.
- **Nothing schedules the sweep in this repository.** The endpoint exists and is authenticated; the
  cron entry belongs to the deployment, and `.env.example` carries the invocation.
- **No provider is configured anywhere.** Without `RESEND_API_KEY` and `EMAIL_FROM` the console
  transport runs, which exercises the whole outbox and delivers nothing. Fabricating credentials to
  look finished was out of scope, and choosing the mailbox is the owner's decision.
- **The two credential messages have no delivery record**, by design (ADR-026). "Did the code
  send?" cannot be answered from the database.
- **`notifications.adminRecipients` is seeded empty**, so a fresh database announces nothing to the
  workshop until it or `ADMIN_NOTIFICATION_EMAIL` is set. That is deliberate — a default address
  would be somebody's real inbox in a repository — and the `SKIPPED` rows say so.

### Validation

Format, lint, typecheck, **698** unit, component and database tests, **107** Playwright tests
across three projects, the production build, the architecture probes, and a clean-database
migration replay with the seed run twice, `migrate diff` reporting no drift, and the full suite run
against it all pass. Counts are the final run's. The suite was run three times consecutively after
the last change, with the same result each time.

Two tests failed only in the full parallel run, and the cause was a real shared-state defect rather
than flakiness: the memory transport injected failures with a **global counter**, which is spent by
whichever message happens to be dispatched first — and in a full run the suites placing orders in
parallel enqueue into the same database, so the injected failure landed on somebody else's row. The
counter is now a marker matched against the message's own text (`failEmailsMatching`), so an
injected failure belongs to the test that asked for it. The two retry tests assert on their own
row's status and attempt count rather than on a global count of sent messages.

---

## Previous

**Phase 12 — Admin operations. Complete (the operational half).**

The workshop can now run a business day without touching the database: find the work, ask a
customer for what is missing, price and send a quote, confirm an order, put it into production,
ship it with a tracking number, take a deposit against a transfer receipt, and keep a note nobody
outside the workshop will ever read.

Two rules govern every write it added. **The state machine decides and the repository applies** —
a move is validated by `domain/order/state-machine` with its payload, then claimed with a
conditional `UPDATE` so two admins cannot both win. And **money is re-read, never received** — no
admin payload carries a total, `paymentStatus` is derived from the payment rows rather than set,
and the starting status of a transition is read from the row so a client cannot pick a `from` that
makes its target legal.

---

## TASK-016: Phase 12 — Admin operations

Status: DONE (operational half; see "Deliberately not built")

Related docs: `docs/BUSINESS-RULES.md` sections 8, 8.10 and 12, `docs/DATABASE.md` section 8,
`docs/UX.md` section 9, `docs/SECURITY.md` section 13, ADR-022

### Delivered

- **The admin shell** — five sections, the current one marked with `aria-current`, a sign-out that
  revokes the session server-side, and a disclosure menu below 768px.
- **`/admin`** — the seven operational queues `UX.md` section 9 asks for, every row a link.
- **`/admin/requests`** — the Phase 10 queue, now filterable by status through the URL.
- **`/admin/quotes`** — sent, viewed and accepted quotes, with the effective status (7.4).
- **`/admin/orders` and `/admin/orders/[orderNumber]`** — the queue with a status filter, and the
  workspace: snapshot-backed items, the address, the payments, the whole history including
  internal entries, and the controls for whichever moves the machine allows.
- **`/admin/customers` and `/admin/customers/[userId]`** — the registered-account directory,
  searchable by name or address, with each customer's orders, requests and quotes.
- **`domain/order/payment`** gained the recording rules: `validatePaymentEntry`,
  `outstandingBalance`, `outstandingDeposit`, `suggestPaymentKind` and the label maps.
- **`domain/order/state-machine`** gained `ORDER_STATUS_LABELS` and `isOrderInFlight`.
- **`domain/permissions`** gained `mayManageOrders`, `mayViewCustomerDirectory`,
  `mayRecordPayments` and `mayReadAuditLog`, so 12.1 stays a set of pure predicates.
- **`server/services/order-admin-service`** and **`admin-dashboard-service`** — the use cases.
- **The deposit loop of 8.10** — the customer sends a transfer receipt from their order page, the
  workshop opens it through a Phase 9 signed URL, accepts or refuses it with a reason the customer
  reads, and records a payment. Recording the payment is what moves `paymentStatus`.
- **A migration** adding `order_payment_proofs` and its enum, the two proof check constraints, the
  partial unique index that permits one outstanding proof per order, `payments_amount_positive`,
  and the two queue indexes.

### Four things worth recording

**The reservation state is derived from the history, not stored.** ADR-022 leaves an order that
entered `AWAITING_PAYMENT` holding nothing until it is confirmed, while one that entered
`AWAITING_CONFIRMATION` reserved at placement. Whether an order currently holds a reservation is
therefore a function of `order_status_history` — which `DATABASE.md` section 8 already calls the
truth — and so is the status an `ON_HOLD` order was held from. A column for either would have been
a second copy of a fact the append-only history carries exactly.

**No admin payload carries a `from`.** The status a transition starts at is read from the row.
A client that could name its own starting point could pick one from which its target is legal, and
`DELIVERED → REFUNDED` is legal from `DELIVERED`. A test posts `from: 'DELIVERED'` against an
order in `AWAITING_CONFIRMATION` and asserts nothing moves.

**A payment is refused against a stale balance.** The service passes the `amountPaid` its screen
was showing, and the repository writes only if the row still agrees. Two payments recorded at the
same instant would otherwise both be applied to a balance that had already moved; one is now
refused with "rechargez", and a test races them.

**The design system and the domain disagreed about one word.** `ON_HOLD` was "En attente" in the
domain and "En pause" on the badge — and "en attente" already meant "waiting for your deposit" two
rows above it. Both are "En pause" now. An end-to-end test that selects a status by its label is
what found it, which is the argument for driving the real controls rather than calling the action.

### The security boundary

Every admin action authorises independently — `requireStaff`, then the capability predicate over
the loaded actor — because the layout guards what is rendered and an action is reachable without
rendering anything. A signed-in customer is redirected home rather than refused, so the workshop's
existence is not confirmed to them.

Thirty-eight integration tests are written against this, adversarially: a forged `from`, a status
that is not a status, a total and a `paymentStatus` in a payment payload, an amount beyond the
balance, a refund beyond what was taken, a negative payment inserted straight into the table, two
simultaneous transitions, two simultaneous payments, a proof submitted against somebody else's
order, a proof file the submitter does not own, a second outstanding proof, a proof refused with no
reason, a fabricated order number, a fabricated proof id, a fabricated customer id, a staff account
looked up in the customer directory, and an internal note read from the customer's projection.

### Deliberately not built

`ROADMAP.md`'s Phase 12 entry is wider than this brief's. What remains, none of it quietly
dropped:

- **The guest half of the customer directory** — `UX.md` section 9 describes a union of registered
  accounts and phone-grouped guest contacts. Only registered accounts are listed.
- **Review moderation, gallery curation and content management** — Phase 13's.
- **The settings screens, the audit-log viewer and admin dark mode.** The audit log is *written*
  (12.5) and has no reader; `mayReadAuditLog` exists for the screen that will.
- **Admin catalogue management** — product CRUD, images, variant generation, stock. Phase 6's own
  unfinished half, and still the thing that keeps the catalogue equal to whatever the seed wrote.
- **Placement anchor editing.**
- **Notifications.** No e-mail is sent by any transition; Phase 8A owns the outbox.
- **Analytics, carrier APIs, production scheduling, online payment providers, coupons, wishlist and
  reorder** — all explicitly out of scope, and none of them stubbed.

### Known limitations

- **`estimatedDeliveryFrom`/`To` are still null.** Section 4.5 counts them from `confirmedAt`, which
  now happens — but the production lead time it also needs has no settings key, and inventing one
  would be inventing a delivery promise. The open decisions below still carry it.
- **`depositWindowDays` is unused.** 8.10.5 flags an order left awaiting payment past the window;
  the value is a placeholder pending the owner, so the queue orders by age instead and flags
  nothing.
- **A refund is recorded but changes no status.** `DELIVERED → REFUNDED` exists in the machine and
  a `REFUND` payment row subtracts from `amountPaid`; tying the two together is a decision about
  returns policy the business has not made.
- **User management does not exist.** Promoting an account to `STAFF` is a database update, which
  is why both end-to-end suites do exactly that and say so.

### Validation

Format, lint, typecheck, **652** unit, component and database tests, **105** Playwright tests
across three projects, the production build, all four architecture probes, and a clean-database
migration replay with the seed run twice and the integration suite run against it all pass. Counts
are the final run's.

Accessibility: axe reports no WCAG 2.1 A/AA violations on `/admin`, `/admin/requests`,
`/admin/quotes`, `/admin/orders`, `/admin/orders/[orderNumber]`, `/admin/customers` or
`/admin/customers/[userId]`. No horizontal overflow on any admin route at 375, 768, 1024 or
1440px.

Two fixture races were found and fixed rather than re-run, both in this phase's own end-to-end
file: a `describe` split across workers ran its `afterAll` twice and deleted the account the other
worker was signed in as — the block is serial now, and the three blocks' fixture prefixes are
disjoint rather than nested, because `LIKE 'a-%'` matches `a-b-…` too. And a test that read a quote
number from the **shared** admin queue picked up whichever suite had sent last; it reads its own
request's workspace instead.

---

## Previous

**Phase 11 — The customer portal. Complete.**

A customer now has a place to see everything the business holds for them: their requests, the
quotes they have been sent, their orders, and the artwork they uploaded. The portal adds **no
business rules**. It composes Phases 7 to 10 — ordering from `domain/request` and `domain/order`,
quote status from Phase 10's own view, artwork from the Phase 9 boundary — so there is nowhere in
it for a second version of a rule to live.

The one thing it does add is a boundary, and it is enforced identically everywhere: **every read
is scoped by `userId` inside the query**, and somebody else's identifier produces exactly what a
made-up one produces.

---

## TASK-015: Phase 11 — Customer portal

Status: DONE

Related docs: `docs/UX.md` section 8, `docs/BUSINESS-RULES.md` sections 6.7, 8 and 12,
`docs/DATABASE.md` sections 8 and 15, `docs/SECURITY.md` section 4, ADR-016

### Delivered

- **`/account`** — the triage screen `UX.md` section 8 specifies, in its priority order: quotes
  awaiting a response (soonest expiry first), orders in flight, requests under review, recent
  orders, then the ways out. No statistic anywhere on it.
- **`/account/requests` and `/account/requests/[requestNumber]`** — the request, its configuration
  read from the frozen snapshots, its artwork, its customer-visible timeline, the quotes it has
  produced, and the reply box.
- **`/account/orders` and `/account/orders/[orderNumber]`** — the order rendered entirely from its
  snapshots, with the payment position, the address, the tracking and the status timeline.
- **`/account/profile`** — name, address, verification state, account status, and sign out.
- **`server/services/account-service`** — the portal's reads, composed from existing repositories.
- **`server/repositories/user-repository`** — the account row, projected down to five fields.
- **`postCustomerMessage`** — the customer's half of 6.7, resolved through `findRequestForOwner`.
- **`domain/order.ORDER_STATUS_LABELS` and `isOrderInFlight`**, and
  **`domain/order/payment-method.PAYMENT_METHOD_LABELS`** — the copy the portal renders, beside the
  rules rather than in a page.

### Three things worth recording

**A request submitted while signed in now belongs to that account immediately.** It never did:
`persistCustomRequest` left `userId` null for everyone, and a request was claimed only when the
workshop priced it (Phase 10). That was invisible until a portal existed to look for it in — the
customer's own request was missing from their own list. The submitter's account is now written at
submission when there is one; a guest's is still claimed by e-mail later.

**The design system's order statuses were a shorter, older list.** `ORDER_STATUS` carried seven
labels including a `PENDING` the database has never had, while `BUSINESS-RULES.md` section 8
defines eleven. The portal renders a stored `orders.status` straight into that badge, so the
mismatch would have printed `undefined` on a real row. Both maps are the eleven now, and a unit
test asserts the domain's labels cover the state machine exactly.

**The Phase 10 intermittent test failure is identified and fixed — and it was four assertions,
not one.** Every one of them measured the whole database rather than the thing under test, so any
suite working in parallel could fail it for an unrelated reason:

| Assertion | What it counted | Now |
| --------- | --------------- | --- |
| `checkout.test.ts`, rollback | every order in the database | orders naming this fixture's variant |
| `auth.test.ts`, OTP replay | every outstanding verification row | the delta across the replay |
| `auth.test.ts`, guest orders | every user in the database | no guest order carries a user |
| `custom-request.test.ts`, refusal | every custom request | requests for this file's address |

A fifth, of the same family, was found while confirming the fix: Phase 10's freeze test
deactivated a **seeded** placement to prove a sent quote still renders what it quoted, and while
it was deactivated any other suite resolving that placement failed with "cet emplacement n'est
pas disponible" — in tests that have nothing to do with placements. The quote suite now creates
its own placement and its own customisation profile and deactivates those.

The first is the one Phase 10 saw: it began failing when Phase 10's quote suite started placing an
order, at about twice in thirty runs — too rare to catch. Adding a third order-placing suite this
phase made it frequent enough to identify. **Confirmed by reverting the fix and reproducing the
failure, then restoring it**; the full suite has since run more than twenty times clean, including
the two sequences that used to trigger it — an end-to-end run followed by the unit suite, and a
production build followed by it.

The lesson worth keeping: a test that counts rows it did not create is asserting something about
every other test.

### The security boundary

Eighteen adversarial cases, at the **service and repository** level rather than the page:
another customer's request, quote, order, artwork and messages; fabricated request, quote, order
and design-file identifiers; a payload trying to write an `INTERNAL_NOTE`; an internal note in a
timeline; an internal status-history entry; `orders.internalNotes`; a quote's `internalNotes`; a
guest token presented inside the account area; a deleted design file; a quarantined one; and a
customer answering a `NEEDS_INFO` question to see whether it clears the block.

A foreign identifier and an invented one produce the same answer, asserted by comparing them.

### Deliberately not built

- **The address book.** `UX.md` lists `/account/addresses`; no address is reusable in V1 because
  checkout writes a snapshot per order, so the screen would be a list of one thing per order.
- **Editing a name or a password.** Both flows exist in Better Auth and neither has a screen. The
  profile page says so rather than showing a disabled field.
- **Post-purchase account creation and guest-order claiming.** A guest order is not in the portal
  until it is claimed, and claiming is the flow that does it. The empty state says where such an
  order can still be found.
- **Re-order, wishlist, the design library and reviews** — all V1.5.
- **Uploading a new file when answering a `NEEDS_INFO` question.** The reply is text; artwork goes
  through a new request. Wiring the Phase 9 uploader into the thread is the obvious next
  increment.

### Known limitations

- **A guest request appears only once it is claimed.** Submitting while signed out and then
  registering with the same address does not retroactively attach it; pricing it does.
- **The order timeline is usually one line.** `order_status_history` is written by the admin order
  workspace, which is Phase 12, so most orders show only their placement.
- **`amountPaid` is always zero in practice.** Payments are recorded by hand in the admin, which
  does not exist yet, so the payment card reads "non réglée" for every real order today.

### Validation

Format, lint, typecheck, **579** unit, component and database tests, **94** Playwright tests across
three projects, the production build, all four architecture probes and a clean-database migration
replay with the seed run twice and the integration suite run against it all pass. Counts are the
final run's.

Accessibility: axe reports no WCAG 2.1 A/AA violations on `/account`, `/account/requests`,
`/account/requests/[requestNumber]`, `/account/orders`, `/account/orders/[orderNumber]` or
`/account/profile`. No horizontal overflow on any portal route at 375, 768, 1024 or 1440px.

Prisma is imported in exactly seven files: `lib/db/client.ts` and the six repositories.

---

## Previous

**Phase 10 — The quote lifecycle. Complete.**

A custom request now becomes a priced quote, and an accepted quote becomes a commitment the
business can be held to. The three things that make that safe are each enforced in exactly one
place: **a sent quote is immutable** (a conditional `UPDATE` on `status = 'DRAFT'`), **only the
owning customer accepts** (ownership filtered in the query, then re-checked over the loaded row),
and **acceptance is one transaction** whose conditional claim makes two simultaneous acceptances
produce exactly one cart.

**No total, at any point, comes from a browser.** The admin sends lines; the server derives the
subtotal, the discount, the shipping, the grand total and the deposit — and there is no field in
any schema here for one to arrive in.

---

## TASK-014: Phase 10 — Quote lifecycle

Status: DONE

Related docs: `docs/BUSINESS-RULES.md` sections 2.6, 5A, 6 and 7, `docs/DATABASE.md` sections 10
and 15, `docs/UX.md` sections 2 and 6, `docs/SECURITY.md` sections 4 and 7, ADR-015, ADR-016,
ADR-023, ADR-025

### Delivered

- **`domain/quote`** — the 7.1 transition table, `isEditable`, the two independent expiries with
  their lazy checks, and the `Q-1042` / `Q-1042-v2` numbering.
- **`domain/quote/pricing`** — the 2.6.2 totals, the sign and quantity rules, and the four
  sendability conditions of 2.6.3.
- **`domain/request`** — the 6.1 table, the 6.2 actor rules, and the predicate that keeps 6.7's
  distinction real: `MESSAGE` changes nothing, `NEEDS_INFO` blocks and requires a reason.
- **`domain/permissions`** gained `mayRespondToQuote` and `mayReadDesignFile`, so 12.3 and 12.1
  are pure predicates rather than checks written inline.
- **`server/auth/guards`** — the action wrappers `ARCHITECTURE.md` section 8 has always specified.
- **`server/services/quote-service`** — suggest, draft, price, send, view, accept, decline,
  cancel, transition, message.
- **A migration** adding `quote_number_seq`, `next_quote_base()`, the quote and quote-line check
  constraints, and the partial unique index that permits one outstanding quote per request.
- **The admin workspace** at `/admin/requests` — the queue ordered by who is holding the work, and
  a request workspace with the configuration, the artwork, the whole timeline including internal
  notes, the message and needs-info controls, the quote editor, the customer preview, send, and
  the version history.
- **The customer's side** at `/account/quotes` — the list, the itemised quote with its expiry, and
  accept and decline.
- **`/checkout/quote/[cartId]`** — the accepted quote's own checkout, which is what finally makes
  Phase 8's quote-bound branch reachable.
- **`/login` and `/register`**, because only the addressed customer may accept.

### Four things worth recording

**The quote sequence yields a base, not a number.** `Q-1042-v2` is version 2 of the family
`1042`, so a revision reuses its predecessor's base and only the suffix moves. A sequence per
quote would have given version 2 an unrelated number and made the version history unreadable.

**A separately priced `EMBROIDERY` line becomes a `CUSTOM` order item, not a `FEE` one
(ADR-025).** Section 2.6.5 offered `FEE`, but a `FEE` item is constrained to quantity 1, no
configuration and `requiresProduction = false`, and embroidery is none of those. The constraints
were right and the table was too narrow.

**The transition table is consulted by the query that enforces it.** Enforcement has to happen
in SQL — a check in JavaScript is made before the row is locked, and two simultaneous acceptances
would both pass it — so every status change is a conditional `UPDATE`. The statuses it may claim
from come from `statusesThatCanReach`, which reads `QUOTE_TRANSITIONS`, so the table stays the
only place the rule is written and the two cannot drift.

**The Phase 8 request-number retrofit was half-shipped, and Phase 10 found it.** The migration
created `next_request_number()`; the repository still read `MAX(request_number)`. Nothing had ever
created two requests at once, so nothing noticed until this phase's suite did — and then it
collided on the unique index, exactly as the Phase 7 audit predicted. The call site now uses the
sequence.

### The security boundary

The draft payload has **no subtotal, no discount, no shipping, no grand total, no deposit, no
status, no quote number and no version**. The one identifier it may carry, `requestItemId`, is
checked against *that request's* items before it is stored, so a quote line cannot be pointed at
another customer's configuration.

Fifty-nine integration tests are written against this, adversarially: an update of a sent quote,
a foreign customer accepting, a foreign customer reading, an expired quote accepted, three
simultaneous acceptances, a coupon forced onto a quote-bound cart, a quantity change on a
quote-bound line, a catalogue rename after the send, version 2 rewriting version 1's freeze, an
internal note reaching a customer timeline, and a payload asking politely for `grandTotal: 1` and
`status: 'SENT'`.

### Deliberately not built

- **"Request an updated quote"** (7.9, 7.10.3) as a clone. An expired quote is read-only and says
  so, and the customer is pointed at a new request. Cloning a frozen configuration into a fresh
  one is the missing half, and it belongs with the multi-item builder it shares its code with.
- **The scheduled expiry jobs.** `expireOutstandingQuotes` and `invalidateLapsedQuoteCarts` exist
  and are tested; nothing calls them on a timer, and Phase 8A owns the cron. The lazy checks are
  what make that safe: every read and the checkout path both compute expiry themselves, so a
  stalled job cannot make a lapsed quote redeemable.
- **Notifications.** `request.submitted` and `quote.expiring` are Phase 8A's.
- **`/admin/quotes`**, the dashboard, the order workspace and user management — Phase 12.
- **Quote line templates** ("Standard setup fee"), which `UX.md` section 6 asks for. The editor
  starts from the configuration's own suggestion instead.
- **Password reset and e-mail verification screens.** The flows exist from Phase 3.1; the screens
  belong with the account area in Phase 11.

### Known limitations

- **A quote needs a customer account.** `quotes.userId` is NOT NULL, so pricing a guest's request
  binds it to the account matching its e-mail address — and refuses, with an explanation, when no
  such account exists. The customer must register with the address they gave. Post-purchase
  account creation and guest claiming are Phase 11.
- **There is no sign-out control.** The account area is Phase 11 and the header has one link.
- **Acceptance requires a verified address**, and the verification screen does not exist yet, so
  in practice a customer verifies through the flow Phase 11 builds.
- **A revision is authored from scratch.** Saving a new draft while a quote is outstanding creates
  version N+1, but the editor starts from the configuration's suggestion rather than from version
  N's lines.

### Validation

Format, lint, typecheck, **543** unit, component and database tests, **84** Playwright tests
across three projects, the production build, all four architecture probes and a clean-database
migration replay with the seed run twice all pass. Counts are the final run's.

Accessibility: axe reports no WCAG 2.1 A/AA violations on the customer quote page, the
quote-bound checkout, `/login` or `/register`. No horizontal overflow at 375px on the two new
storefront routes.

The intermittent failure this phase reported as open and unproven was **identified and fixed in
Phase 11**: `checkout.test.ts`'s rollback assertion counted *all* orders, and Phase 10's quote
suite began placing one in parallel. Recorded here so the trail from "seen twice, cause unknown"
to "reproduced, fixed" stays in the project record rather than disappearing.

A pre-existing drift was closed on the way: the `design_files` owner-token index was named one
thing by the Phase 9 migration and another by the Prisma schema, so a clean replay reported a
difference for an index that was otherwise identical. The schema now names it explicitly.

---

## Previous

**Phase 9 — The design-file pipeline. Complete.**

A customer's artwork is now stored for real: authorised, uploaded straight to private object
storage, and then **verified by the server from its own bytes** before it becomes usable. The
magic number, the extension and the declared type must agree, rasters are decoded under a pixel
cap, and an SVG carrying a script is refused with a reason rather than quietly rewritten.

**Nothing the browser says about a file is evidence** — not its name, not its type, not its size,
and not its claim that the upload succeeded.

---
## TASK-013: Phase 9 — The design-file pipeline

Status: DONE

Related docs: `docs/SECURITY.md` sections 6 and 7, `docs/ARCHITECTURE.md` section 9,
`docs/DATABASE.md` section 6, ADR-009, ADR-011, ADR-024

### Delivered

- **`lib/storage`** — the adapter interface `ARCHITECTURE.md` section 9 specifies, with an
  S3-compatible implementation (Cloudflare R2, ADR-009) and a filesystem implementation for
  development and the test suite. Every provider-specific line in the project is in `s3.ts`.
- **`domain/design-file`** — the allowlist, the limits, magic-number detection, filename
  sanitisation, the agreement rule and the SVG inspection, as pure functions.
- **`lib/media/raster`** — the only place that decodes an image, under an explicit pixel cap.
- **`server/services/design-file-service`** — presign, verify, promote, sign, discard, sweep.
- **`/api/storage/local`** — the development stand-in for the provider's endpoint, so the flow
  under test is the real one. It disappears the moment a bucket is configured.
- **A migration** adding `design_files.owner_token_hash`, its check and its indexes.
- **The builder uploads for real** — the same five steps, the same file cards, with an upload
  status, a retry and a server-generated preview.

### The pipeline

Three steps, and the middle one never touches the application:

    browser -> presigned PUT -> storage -> server verifies the stored bytes -> READY

**A file is not `READY` because the browser says the upload worked.** The client's only
contribution to finalisation is the file's id, scoped to its owner before anything is read. The
server HEADs the object for its real size, reads its bytes for its real type, requires the
extension, the declared type and the magic number to agree, decodes rasters under a pixel cap,
refuses hostile SVG, generates the preview, promotes out of `quarantine/`, and only then writes
`READY`.

### Ownership

A file is created at presign time, before any request exists, so it carries an owner from the
first moment: `ownerUserId`, or the SHA-256 of **the same guest token that identifies a guest
cart**. One browser is one guest across uploads, cart and orders — not a second identity system.
Every read is scoped in the query, and a foreign id returns "not found" rather than "not yours".

### What this closes from Phase 7

Condition 7 of `BUSINESS-RULES.md` 2.3 asks whether every attached file is `READY`. No file could
be, so **any artwork forced a quote**. Files are stored and validated now, so an ordinary logo on
an otherwise simple configuration is a fixed price again. An integration test asserts it.

### Two decisions worth recording

**A hostile SVG is refused, not sanitised (ADR-024).** `SECURITY.md` described sanitising on
ingest. V1 renders an SVG nowhere, so a rewriter buys nothing at render time while adding an XML
parser and re-serialiser to the attack surface — and silently altering a customer's logo is worse
for them than being told which construct to remove. What passes is stored byte-for-byte.

**A deployment is recognised by its origin, not by `NODE_ENV`.** `npm run build && npm run start`
on a laptop is production too, and it is how the E2E suite runs. The filesystem adapter is
permitted only on a localhost origin; anything else without credentials throws, naming the missing
variables.

### Deliberately not built

- **Admin media management**, and the admin order workflow it belongs with.
- **The design-on-product preview** of ADR-011, `/custom/[step]` URLs, draft persistence and
  multi-item requests. Phase 9's roadmap entry lists them; this phase implemented the upload
  pipeline it names, which is what the rest depends on.
- **The public asset bucket.** `S3_BUCKET_PUBLIC` is reserved in `.env.example` and read by
  nothing: product photography is uploaded by an admin, and there is no admin.
- **Malware scanning.** `QUARANTINED` exists and the pipeline has the insertion point; V1.5 owns
  the scanner (`SECURITY.md` section 6).

### Known limitations

- **The S3 adapter has never run against a bucket.** No credentials and no bucket exist, so it is
  exercised by nothing but the type system. Provisioning R2 and running one upload end to end is a
  prerequisite for launch, and belongs on the deployment checklist rather than in a test.
- **The sweep is a function, not a schedule.** Nothing calls `sweepStalePendingUploads` yet; the
  cron arrives with the scheduled jobs in Phase 8A. Until then an abandoned upload's row lives on,
  though the bucket's own 24-hour lifecycle rule still takes the object.
- **Rate limiting.** The presign endpoint is unauthenticated, like every other public write.
  Phase 15 owns it.

### Validation

Format, lint, typecheck, the unit and integration suites, the Playwright suites including a repeat
pass over the upload flow, both boundary probes and the production build all pass.

---
## TASK-012: Phase 8 — Cart, checkout and orders

Status: DONE

Related docs: `docs/BUSINESS-RULES.md` sections 4, 5, 5A, 8 and 10, `docs/DATABASE.md` sections 7
and 8, `docs/UX.md` section 7, `docs/ARCHITECTURE.md` section 6, ADR-015, ADR-022, ADR-023

### Delivered

- **`/cart`, `/checkout` and `/order/[orderNumber]`** — a guest can put a product in a cart, give
  their details, choose a delivery, and receive a real order number. No account is asked for at
  any point.
- **`domain/shipping`** — zone-and-rate resolution, the free-delivery threshold read from
  `shipping_rates.freeOverAmount` and nowhere else, and the immutable rate label.
- **`domain/order/totals`** — the section 5.1 pipeline, once, plus the quote reconciliation
  assertion of 5A.6.
- **`domain/order/deposit`** — the 5.5 branches in order, with the quote's deposit copied rather
  than recomputed.
- **`domain/order/state-machine`** — the full 8.1 transition table, the payload each transition
  requires (8.7), the entry status (8.2), and `reservesStockAtPlacement` (ADR-022).
- **`domain/order/payment`** — payment status derived from payment rows, never set.
- **`domain/order/payment-method`** — V1's three methods, and the rule that a custom order is not
  cash-on-delivery.
- **`domain/cart`** — quote-bound immutability, quantity bounds, and the merge arithmetic.
- **`server/services/cart-pricing`** — the single pricing path the cart, the checkout and
  placement all use.
- **A migration** adding two sequences, two identifier functions, and the check constraints and
  partial indexes `DATABASE.md` sections 7 and 8 have always specified but Prisma cannot express.

### Order numbers are sequence-backed now

Phase 7's `nextRequestNumber` read `MAX(request_number)` and its audit recorded the race. Phase 8
does not repeat it: `next_order_number()` and `next_request_number()` sit over PostgreSQL
sequences, and the request-number retrofit shipped in the same migration, seeded past the highest
number already issued. Six concurrent placements produce six distinct numbers, asserted by a test.
The cost is gaps on rollback and no yearly restart, both recorded in ADR-023.

### The security boundary

The checkout payload has **no price, no subtotal, no discount, no shipping amount, no total and no
deposit** — absent from the Zod schema, so a payload carrying them fails to parse. The same
technique as Phase 7, for the same reason.

Thirty-six integration tests are written against it: a draft product's slug, another product's
variant, an inactive variant, a quantity of 1000, a payload asking for `grandTotal: 1` and
`status: 'CONFIRMED'`, a cart line belonging to somebody else, a wilaya nobody delivers to, two
simultaneous checkouts for the last unit in stock, and a placement that fails halfway.

### Two decisions worth recording

**Reservation follows the entry status, not placement (ADR-022).** Section 10.4 reads as "reserve
at placement" and 8.10.3 says an order awaiting payment reserves nothing. They reconcile if
"order confirmation" means the `CONFIRMED` transition: availability is validated every time, and
the reservation is taken at placement only when no deposit is outstanding.

**A check constraint found a real bug.** `order_items_fee_check` rejected a quote's fee line
reaching the order without a `feeKind`, because `cart_items` has no such column and the mapping in
2.6.5 had not been carried through. Fixed by reading the kind from the quote line. This is the
argument for the constraints in one paragraph.

### Deliberately not built

- **Admin order management.** The state machine and the derived payment status exist and are
  tested; the workspace that drives them is Phase 8's admin half and is not built here.
- **The `CONFIRMED` transition**, and therefore the deferred stock reservation for a deposit
  order. It belongs with the admin confirmation that triggers it.
- **Deposit proof upload.** It needs private object storage, which is Phase 9. The confirmation
  page states the amount and the reference, and says the details follow by e-mail.
- **Notifications.** Nothing is sent; Phase 8A owns the outbox dispatcher.
- **Guest order tracking by number plus phone**, and the account-claiming flow.
- **Coupons** (V1.5) — the cart refuses one structurally on a quote-bound cart, which is the only
  rule that had to exist now.

### Known limitations

- **The header cart badge shows no count.** Reading it needs the cart cookie, and a cookie read in
  the storefront layout would opt the homepage, the shop and every product page out of static
  rendering to keep a badge current. The cart page itself is accurate.
- **`estimatedDeliveryFrom`/`To` are left null at placement.** Section 4.5 counts them from
  `confirmedAt`, which has not happened; the day range is shown at checkout instead. The
  production lead time 4.5 also requires has no settings key — see open decisions.
- **Quote-bound checkout is enforced but unreachable.** Acceptance is Phase 10, so the only way to
  reach that code today is the integration test, which builds the state acceptance will leave.

### Validation

Format, lint, typecheck, the unit and integration suites, the Playwright suites, both boundary
probes and the production build all pass. Counts are in the phase report rather than here, because
a number in a document ages badly.

---

## TASK-011: Phase 7 — The custom embroidery builder

Status: DONE

Related docs: `docs/UX.md` section 5, `docs/BUSINESS-RULES.md` sections 2.2–2.5 and 11,
`docs/DATABASE.md` section 14, `docs/SECURITY.md` sections 5 and 6

### Delivered

- **`/custom`** — the five documented steps in one route, because a step is transient UI state and
  a URL per step would invite bookmarking a configuration nothing persists.
- **`domain/money`** — `applyBasisPoints` and `roundHalfUp`, the single conversion section 1.6
  requires.
- **`domain/discount`** — tier selection and the quantity discount, returning a **typed error**
  for a quantity with no tier rather than a silent zero (2.5.2).
- **`domain/pricing/customization`** — the section 2.2 formula, the setup fee charged once per
  configuration, and the estimate band.
- **`domain/customization/pricing-mode`** — the seven conditions of 2.3, returning *every* failing
  one so the customer is told why.
- **`domain/customization/validation`** — what can be built, kept separate from what needs a quote.
- **`server/repositories/customization-repository.ts`** — the builder's reads, the reference
  resolution and the write.
- **`server/services/custom-request-service.ts`** — the submission use case.
- **Embroidery reference data in the seed** — 6 placements, 3 sizes, 14 thread colours, 3 fonts
  and a default profile attached to every customisable product.

### The security boundary

The submission payload has **no price, no estimate, no discount, no deposit and no pricing mode**.
Not "ignored" — absent from the Zod schema, so a payload carrying them fails to parse. Everything
about money is re-derived from rows the client cannot influence, and the placement and size must
belong to *that product's* profile, so a cap's front panel cannot be requested on a tote bag.

Nineteen integration tests are written adversarially against this: a draft product's slug, a
non-customisable product, another product's variant, a placement id that is not a placement, nine
thread colours when eight is the ceiling, and a payload asking politely for `pricingMode: 'FIXED'`
at quantity 11. The last one asserts the stored mode is `QUOTE` and the stored estimate is the
server's number, not the `1` that was sent.

### Two decisions worth recording

**Four settings keys were added.** `BUSINESS-RULES.md` 2.2 always read the thread-colour
surcharge, the text surcharge and the setup fee "from settings", but `DATABASE.md` section 14 —
which calls itself exhaustive — had never named them. The builder could not price a configuration
without either inventing a rate in code or adding them, so they were added, seeded as
**placeholders pending the owner**, and documented. `DATABASE.md` section 14 now lists them.

**A request with an attached file is a quote request.** Condition 7 of section 2.3 requires every
attached design file to be `READY`. No storage exists, so no file can be — which makes
`ARTWORK_REVIEW` an honest reason rather than a fudge, and the confirmation screen says the file
will be requested by e-mail.

### Deliberately not built

- **File storage, previews on the product, and the design-on-product composite.** Phase 9 owns the
  bucket; the preview needs it.
- **Draft persistence.** `UX.md` describes local-storage drafts and resumable server drafts at
  `/custom/builder/[draftId]`. A refresh loses the builder state today. Building half of it — a
  draft that silently loses an upload — would be worse than none.
- **"Add another product to this request".** `custom_request_items` supports several items and the
  service writes one; the multi-item UI is the next increment.
- **Placement diagrams.** `UX.md` asks for a garment silhouette per placement. The illustrations do
  not exist, so the builder shows the placement name and its millimetre limits instead.
- **Everything downstream**: quotes, cart, checkout, payment, orders, admin, notifications.

### Known limitation

`nextRequestNumber` derives the next number from the highest existing one rather than a database
sequence, so two simultaneous submissions would collide on the unique index. Correct under the
concurrency this phase sees; `DATABASE.md` section 1 calls for a sequence and one is needed before
launch.

### Validation

Format, lint, typecheck, **266** unit/component/database tests, **58** Playwright tests, the
production build, and the architecture probes (8 errors from `domain/`, 5 from `components/`, and
1 each from the generated-client probe in `app/`, `domain/` and `components/`) all pass.
Migrations replayed onto a clean database and the seed run twice against it. Prisma is imported in
exactly three files: `lib/db/client.ts` and the two repositories.

Accessibility: axe reports no WCAG 2.1 A/AA violations at **any of the five steps**. Focus moves to
the step heading on every change. No horizontal overflow at 375px at any step.

The axe scan now waits for CSS transitions to settle before it analyses. It previously scanned
immediately after a click and read the 140 ms colour transition mid-flight, reporting a contrast
failure against an interpolated pair — a selected thread-colour swatch that settles at 18:1 was
sampled partway there. It passed in a full suite run and failed five times out of five in
isolation, because the check was really measuring how busy the machine was. The interface was
never at fault; the measurement was.

## Previous

**Phase 6 — Catalogue data. Complete (storefront half).**

---

## TASK-010: Phase 6 — Catalogue data and the storefront read path

Status: DONE (storefront). Admin catalogue management outstanding.

Related docs: `docs/ARCHITECTURE.md` section 6, `docs/BUSINESS-RULES.md` sections 2.1, 10 and 11,
`docs/DATABASE.md` section 5

### Delivered

- **`server/repositories/catalogue-repository.ts`** — the storefront read path, and the only new
  Prisma consumer. Three queries: the listing, a product by slug, and category-adjacent related
  products. Every one has an explicit `select`, a bounded `take`, and its visibility predicate in
  the `where`.
- **Storefront DTOs.** `CatalogueProductSummary` and `CatalogueProductDetail` carry what the UI
  renders and nothing else. No Prisma model, `Decimal`, `Date`, internal id or stock count crosses
  the boundary.
- **`domain/pricing`** — `resolveUnitPrice` and `resolveCompareAtPrice`, the rules
  `BUSINESS-RULES.md` section 16 requires to exist exactly once.
- **`domain/order/availability`** — `availableQuantity`, `isVariantPurchasable`,
  `isProductPurchasable`, per section 10 and section 11.2. The product page is a named consumer in
  the section 16 table, which is why they live there rather than in the repository.
- **`lib/media/public-asset.ts`** — resolves a `storageKey` against
  `NEXT_PUBLIC_PUBLIC_ASSET_URL`. That bucket arrives in Phase 9, so today every key resolves to
  `null` and the media primitives render their placeholder.
- **A demo catalogue in the seed** — 4 categories, 7 published products, 10 options, 26 option
  values, 35 variants and 11 image records. Deterministic and idempotent.
- **`error.tsx` for the storefront**, so a catalogue failure is a designed screen with the shell
  intact and no database detail on it.

### Three seeded rows that exist to be tested

The seed plants specific cases rather than uniform happy-path data:

- **A `DRAFT` product** in a category the storefront links to. Four assertions check it never
  appears — in the listing, by slug, among related products, or over HTTP.
- **One sold-out combination** on the t-shirt (Écru / S), so the variant matrix has something to
  mark without the product itself being unavailable.
- **A product with every variant out of stock** (the bonnet), which must render at 200 with its
  action disabled rather than 404 — `BUSINESS-RULES.md` 11.3, visible but not purchasable.

### Decisions worth recording

**Availability marking does not narrow one axis against another.** Filtering each option by the
others reads as clever and traps people: with "S / Noir" chosen, an available "M / Écru" piece
would show Écru disabled and no click escapes. The panel marks only values that *no* available
variant carries, and reports a non-existent combination at the action, where the user is about to
act on it.

**Related products are category-adjacent.** The schema has no related-products table;
`collections` is the editorial grouping and is V1.5. Category adjacency is the relationship that
exists, so it is what the query uses, bounded by `take` and excluded by slug in SQL.

**ISR with a five-minute window, and no `generateStaticParams`.** Documented in
`ARCHITECTURE.md` section 6. Tag-based revalidation replaces the timer when the admin can mutate
products and therefore knows what to invalidate.

### Validation

Format, lint, typecheck, **196** unit/component/database tests, **46** Playwright tests across
three projects, production build, and both architecture probes (8 errors from `domain/`, 5 from
`components/`) all pass. Migrations were replayed onto a clean database and the seed run twice
against it; zero schema drift, and no migration was needed this phase.

Prisma is imported in exactly two files: `lib/db/client.ts` and the catalogue repository. No
component imports the database, auth, a server module or `domain/`. No client component imports
the repository.

Accessibility: axe reports no WCAG 2.1 A/AA violations on `/`, `/shop`, `/shop/[slug]` or
`/custom`. No horizontal overflow at 375, 768, 1024 or 1440.

### Outstanding for the rest of Phase 6

- **Admin catalogue management**: product CRUD, image upload to the public bucket, option and
  variant generation, stock management.
- **Listing controls**: search, category filter, option filters, sorting, pagination. Still absent
  rather than decorative, and the repository is already paginated in shape
  (`CATALOGUE_PAGE_SIZE`) so adding them is a query change.
- **`/shop/c/[category]`** with SEO metadata.
- **Real photography.** Every image record points at a key in a bucket that does not exist yet
  (Phase 9); until then the placeholder renders and the alt text is already correct.
- **Tag-based revalidation**, which needs the admin mutations to signal it.
- **Reviews**: `products.ratingAverage` and `ratingCount` exist and are deliberately unread — the
  storefront shows no rating rather than a fabricated one.

## Previous

**Phase 5 — Storefront shell and homepage. Complete.**

---

## TASK-009: Phase 5 — Storefront shell and homepage

Status: DONE

Related docs: `docs/UX.md` sections 2–4, `docs/PRODUCT.md` section 3, `docs/DESIGN-SYSTEM.md`

### Delivered

- **A `(storefront)` route group** with a shared shell — `Header`, `<main>`, `Footer` — and its
  own `not-found.tsx`, so a mistyped product slug keeps the navigation instead of dumping the
  visitor on a bare page.
- **Homepage**: hero with the value proposition in one sentence and the two documented CTAs, the
  four-step custom process, a featured selection, the craft section, and a closing custom CTA.
- **`/shop`**: the grid, responsive from 2 up to 4 columns, with a designed empty state.
- **`/shop/[slug]`**: the 7/5 gallery-and-info split, breadcrumbs, option and quantity controls,
  a details table, and related pieces. Statically generated per product.
- **`/custom`**: the destination the primary CTA needs. It explains the four steps and says
  plainly that the configurator is not open yet.
- **`Footer`** — a new layout primitive, presentational, taking its columns and contact lines as
  props because they become admin settings in Phase 12.
- **A placeholder catalogue** at `app/(storefront)/_data/catalogue.ts`: six pieces, carrying only
  what the UI renders. It is deliberately not the Prisma shape, so Phase 6 changes the source
  rather than the pages.

### The two commercial paths

`PRODUCT.md` section 3 has custom embroidery carrying the margin and the shop as the conversion
baseline, so the hero leads with **Créer ma broderie** in accent — the one place the design system
reserves accent for a CTA — and **Voir la boutique** beside it as the secondary action.

### What is deliberately absent

This phase's main risk is decorating the site with things that do not work, so:

- **No cart, account or search control in the header.** `Header` gained `cartHref`/`accountHref`
  that default to `null` and omit the control. A cart icon leading to a 404 is worse than no cart
  icon; it promises something the site does not have.
- **No filter, sort or search bar on `/shop`**, although `UX.md` section 4 specifies them. A
  filter that does not filter teaches a visitor that the site is broken. They arrive in Phase 6
  with the query that makes them work.
- **The purchase action is disabled and says why.** Not a fake add-to-cart with a success toast.
- **No invented social proof.** No statistics, testimonials, review counts or customer numbers.
- **Footer and navigation list only routes that exist.** The documented four-column IA fills in
  as those pages land; a test asserts every link points at a built route.

### Two decisions worth recording

**Product URLs moved to `/shop/[slug]`.** `UX.md` had products at `/products/[slug]` and
categories at `/shop/[category]`. Two dynamic segments cannot share `/shop/*`, so one had to
move; the product URL is the one customers see and share, so it took the shorter path and
categories gained an explicit `/shop/c/[category]` prefix. `UX.md` section 2 records this.

**The image placeholder became a texture.** With no photography, every tile in the catalogue
shows the same placeholder, and a bare icon on grey made the whole grid look broken. It now draws
a running-stitch motif from `currentColor` — clearly not a photograph, clearly not a broken image.

### Validation

Format, lint, typecheck, **155** unit/component/database tests, **43** Playwright tests across
three projects, production build, and both architecture probes (8 errors from `domain/`, 5 from
`components/`) all pass.

Accessibility: axe reports no WCAG 2.1 A/AA violations on `/`, `/shop`, `/shop/[slug]` or
`/custom`. Every route has exactly one `h1` and the three landmarks. No horizontal overflow at
375px on any route. The mobile drawer opens, navigates and closes; variant options are a
keyboard-operable radio group.

### Follow-ups this phase created

- **Cart, account and search** need the header controls turned back on when they exist.
- **Filter, sort, search and pagination** on `/shop` — Phase 6.
- **`/shop/c/[category]`** — Phase 6.
- **The builder** behind the `/custom` CTA — Phase 7. Until then that page states its own status.
- **Database-backed content pages** (How It Works, About, FAQ, Contact, Gallery, legal) and the
  full footer IA — they need the `pages` and `faqs` tables.
- **Real photography.** Every product image is a placeholder.
- **Settings-driven footer contact and the floating WhatsApp CTA** — Phase 12.
- **Breadcrumb tap targets.** The trail’s links are 16px tall on mobile, below the 44px
  `DESIGN-SYSTEM.md` section 13 asks for. WCAG exempts inline links, and `Breadcrumbs` is a Phase 4
  primitive, so it is recorded here to be changed deliberately in the design system rather than
  patched from a storefront page. Footer links and section links were raised to 44px in this phase.

## Previous

**Phase 4 — Design System. Complete.**

---

## TASK-008: Phase 4 — Design System

Status: DONE

Related docs: `docs/DESIGN-SYSTEM.md` (section 15 documents what was actually built),
`docs/UX.md`

### Delivered

- **Tokens** in `styles/tokens.css`: the warm-neutral palette with one accent, the fluid type
  scale, 4px spacing, tight radii, four elevations plus `--shadow-focus`, the motion tokens, and
  a new `--animate-*` catalogue with its keyframes. Semantic status roles were added so a status
  never reaches for a raw scale value.
- **34 primitives** across foundation, forms, feedback, surfaces, navigation, commerce, media and
  upload. Inventory in `DESIGN-SYSTEM.md` section 15.
- **Radix** for the behaviour that is genuinely hard — focus trapping and restoration, Escape,
  scroll locking, typeahead, roving tabindex. All visuals are ours; no component ships a Radix
  default look.
- **`/dev/design-system`**, which renders every primitive in every state from literals and
  `notFound()`s in production.
- **`lucide-react` as the single icon set**, 1.5px stroke, no second library.
- Dependencies added, all pinned exactly: `radix-ui`, `lucide-react`,
  `class-variance-authority`, `clsx`, `tailwind-merge`, and for testing `jsdom`, Testing Library,
  `eslint-plugin-jsx-a11y`, `@axe-core/playwright`.

### Three real defects the audit caught

Worth recording, because each was invisible in review and each would have shipped:

1. **The type scale was being deleted.** `tailwind-merge` files an unknown `text-*` class as a
   colour, so in `cn(size, tone)` the tone silently removed the size — every captioned, muted or
   subtle piece of text fell back to inherited body size, and the accent button lost its white
   text. Fixed by declaring the font-size tokens to `tailwind-merge` in `components/ui/cn.ts`.
   Found because axe reported a contrast failure at the wrong font size.
2. **`--color-fg-subtle` failed AA.** `#7a7268` measured 4.25:1 on the paper ground, and it is the
   token behind captions, overlines and helper text. Darkened to `#6f675d`, which clears AA on
   paper, white and sunken. The full measurement table is now in `DESIGN-SYSTEM.md` section 14.
3. **`duration-fast` and friends compiled to nothing.** Tailwind v4 has no `--duration-*` theme
   namespace, so the documented motion tokens were not driving any transition. Declared as real
   utilities with `@utility` in `globals.css`.

Two smaller ones: `ProductCard`'s stretched link had no positioned ancestor, so its click overlay
covered the viewport rather than the card; and `Button` with `asChild` threw, because Radix's
`Slot` takes one child and the button always rendered icon slots beside it.

### Accessibility

Axe reports no WCAG 2.1 A/AA violations on the showcase at either viewport. Beyond that: buttons
are `button` and links are `a` (asserted, not assumed); `IconButton` cannot be constructed without
a label; `FormField` owns the id wiring so a control cannot be rendered without its label,
description and error association; dialogs trap and restore focus; loading buttons are `aria-busy`
and disabled so they cannot double-submit; every status pairs its colour with a word.

Two judgement calls worth naming. The disabled `UploadDropzone` dims its frame rather than its
text, because fading the container takes the explanation of *why* it is disabled down with it. And
the hidden file input is `aria-hidden` — the visible buttons are the control, and announcing a
second unlabelled file field beside them helps nobody.

### Validation

Format, lint, typecheck, **137** unit/component/database tests, **21** Playwright tests across
three projects, production build, and both architecture probes (8 errors from `domain/`, 5 from
`components/`) all pass. No component imports Prisma, the database client, Better Auth, a server
module or `domain/`.

### Deliberate limitations

- **Dark mode is defined but unreviewed.** The tokens exist so the admin can opt in without
  restructuring; nothing renders them yet, so they have not been contrast-tested. That belongs to
  the phase that builds the admin.
- **The header is sticky, not scroll-aware.** Section 13 wants the storefront header revealed on
  scroll-up only. That is scroll behaviour the owning page drives, so `Header` takes a `sticky`
  prop rather than burying a scroll listener in a primitive.
- **Status labels are French string unions**, mirroring the database enums rather than importing
  them — `components/` may not import Prisma. A page mapping a row to these props is where the
  compiler checks the two still agree.
- **No table primitive.** `DESIGN-SYSTEM.md` section 8 specifies the admin table in detail,
  including the mobile stacked-card treatment. Building it against no data would be guesswork; it
  belongs to the admin phase.

### Infrastructure note

`next.config.ts` gained an overridable `distDir`. The showcase is development-only, so proving it
is absent in production *and* auditing its accessibility needs both a production and a development
server at once, and the two would otherwise fight over `.next`. The E2E config runs the dev server
with `NEXT_DIST_DIR=.next-dev`. Unset everywhere else.

## Previous

**Phase 3.1 — Email verification remediation. Complete.**

---

## TASK-007: Phase 3.1 — Email verification security remediation

Status: DONE

Related docs: `docs/SECURITY.md` sections 2 and 2.1, `docs/ARCHITECTURE.md` section 7,
`docs/DATABASE.md` section 4, ADR-021 (supersedes the email-verification half of ADR-020)

### The finding

Phase 3 discovered, and ADR-020 recorded, that Better Auth 1.7.2 issues its email-verification
link as a **stateless HS256 JWT**. Nothing is written to the database, so nothing can be consumed:
the same link verified the address as many times as it was presented, for a full 24 hours.
`SECURITY.md` had described verification as single-use, which was simply wrong.

That matters because `emailVerified` is what will gate quote acceptance — a commercial commitment
— and a verification link is a bearer credential that survives in mailboxes, forwarded mail and
upstream logs.

### The remediation

**Better Auth's `emailOTP` plugin with `overrideDefaultEmailVerification: true`** — the library's
own switch for replacing the link flow, not a workaround.

| Property          | Setting                             | What enforces it                                                     |
| ----------------- | ----------------------------------- | -------------------------------------------------------------------- |
| Single use        | —                                   | `consumeVerificationValue` deletes the row in the operation that reads it, and does not recreate it on success |
| Replay rejection  | —                                   | A replayed code finds no row                                          |
| Expiry            | `expiresIn: 900`                    | 15 minutes, down from 24 hours                                        |
| Guessing          | `allowedAttempts: 3`                | The row is left consumed after three failures, locking the identifier out |
| Flooding          | `rateLimit: { window: 60, max: 3 }` | The send endpoint, where rate limiting is active                      |
| At rest           | `storeOTP: 'encrypted'`             | Symmetric encryption under `BETTER_AUTH_SECRET`                       |
| Address privacy   | `storeIdentifier: 'hashed'`         | Already set; the identifier contains the address                      |

**Encrypted rather than hashed, deliberately, and the opposite of the reset token.** An 8-digit
code carries ~27 bits of entropy, so a SHA-256 digest is recovered by trying 10^8 candidates —
milliseconds. Hashing a low-entropy credential looks like protection and is not. The reset token's
~143 bits are a different case, and it stays hashed.

### The trap this configuration sets, and the test that guards it

`runPluginInit` merges plugin options with `defu(userOptions, pluginOptions)`, which gives **our**
options precedence. Re-adding `emailVerification.sendVerificationEmail` to `config.ts` would
therefore silently win, restore the JWT link, and leave `overrideDefaultEmailVerification` doing
nothing at all — with no error anywhere. A test asserts that sign-up produces a code and no URL,
specifically so that edit fails loudly.

### Scope

Changed: `src/lib/auth/config.ts` (plugin added, `sendVerificationEmail` removed),
`src/lib/email/index.ts` (the seam now carries `otp` as well as `url`; both are treated as
credentials and neither is logged), and the verification tests.

Untouched, as required: Better Auth 1.7.2, Prisma 7, PostgreSQL 18, UUID v7, Argon2id,
database-backed sessions, the 30-day and 7-day lifetimes, plaintext session-token storage, hashed
reset identifiers, the authorisation separation, and the guest-user architecture. Password reset
was already correct and was not touched.

### Validation

- **Zero schema changes.** The plugin uses the existing `verification` table, so Phase 3's three
  migrations stand unaltered and no migration was written. `prisma migrate diff` reports no drift.
- Format, lint, typecheck, **82 tests** (up from 75 — eight new verification tests replacing two),
  seed, production build, and both boundary probes (8 and 4 errors) all pass.
- The whole Phase 3 authentication suite runs unchanged apart from the verification block itself;
  no existing security assertion was weakened to accommodate the new mechanism.
- Source audit found no credential logging, no custom verification-token implementation, and no
  second verification system.

### Consequence for later phases

The registration screen needs a code field rather than a "check your email for a link" message,
and the 15-minute window means a resend affordance matters. `UX.md` gains that step when those
screens are designed.

### Now the weakest item in `SECURITY.md`

**Login throttling**, specified in section 9 and not yet built. Until Phase 15 there is no
brute-force limit on the sign-in endpoint. Session lifetimes remain the second review item.

## Previous

**Phase 3 — Authentication. Complete.**

---

## TASK-006: Phase 3 — Better Auth integration

Status: DONE

Related docs: `docs/SECURITY.md` sections 2 and 2.1, `docs/ARCHITECTURE.md` section 7,
`docs/DATABASE.md` section 4, ADR-006 (amended), ADR-019, ADR-020

### Delivered

- **`better-auth@1.7.2`** and **`@node-rs/argon2@2.0.2`**, both pinned exactly.
- **`src/lib/auth/`** — the boundary. `config.ts` builds the instance, `password.ts` holds
  Argon2id, `session.ts` maps a Better Auth session to our `Actor` and enforces the staff time
  cap, `index.ts` exposes `getCurrentActor` and `revokeAllSessionsForUser` and nothing else.
  No Better Auth type leaves the directory.
- **`src/domain/auth/actor.ts`** and **`src/domain/permissions/`** — the `Actor` type and the
  role, ownership and verification predicates, all pure. The full section 12.1 capability matrix
  is filled in by the phases that own those resources; adding it now would be inventing
  permissions for features that do not exist.
- **`src/app/api/auth/[...all]/route.ts`** — the endpoints, pinned to the Node.js runtime because
  Argon2id is a native module.
- **`src/lib/email/`** — the minimal outbound seam Phase 8A implements for real. The development
  transport deliberately does not log the link, since a verification URL is a live credential.
- **Argon2id at OWASP parameters** (19 MiB, t=2, p=1), asserted from the encoded hash prefix
  rather than from the options object.
- **Role-dependent session lifetimes** under a library that has one global setting: clamped at
  creation by a database hook, and held by an absolute cap on `sessions.createdAt` in
  `getCurrentActor`. The cap is the part that matters — the rolling refresh would otherwise
  restore an admin session to 30 days.
- **Boundary lint extended** to reject `better-auth` and `@node-rs/argon2` from `domain/`, and
  `better-auth` and `@/lib/auth` from `components/`. Both probes verified.

### Findings from the integration spike

Each of these came from reading `better-auth@1.7.2`, and each contradicted an assumption:

1. **`accounts.issuer` is required and is half the account key.** `updatePassword` filters on it,
   so a NULL issuer would make password resets report success while changing nothing. The unique
   index is `(issuer, accountId)`, not `(providerId, accountId)`. ADR-019, migration
   `20260905160000_better_auth_account_identity`.
2. **Reset tokens can be hashed at rest through `verification.storeIdentifier: "hashed"`** — a
   supported configuration option, not the unsupported adapter Phase 2.3 rejected. Enabled.
   ADR-020.
3. **Email verification stores nothing and is not single-use.** It is a stateless HS256 JWT signed
   with `BETTER_AUTH_SECRET`, replayable for its full 24 hours. `SECURITY.md` had this wrong and
   now says so. **Resolved in Phase 3.1 (TASK-007)** by replacing the link with a one-time code.
4. **Session tokens carry ≈190 bits of entropy, not 256.** 32 characters over a 62-character
   alphabet from `crypto.getRandomValues`. Ample, but the documented figure was wrong.
5. **Duplicate sign-up does not throw.** With `autoSignIn: false`, Better Auth answers with a
   synthetic user and a null token, and hashes the submitted password anyway so timing matches —
   deliberate anti-enumeration. The test asserts the security property, not an exception.

### Deliberately not done

No login, register, reset or account UI. No rate limiting on the sign-in endpoint — that is
specified in `SECURITY.md` section 9 and belongs to Phase 15 with the rest of rate limiting. No
common-password list; it belongs with the registration form. No OAuth provider, no 2FA, no admin
user seeded.

### Carried into the post-Phase-3 security review

In the order they are worth arguing about:

1. ~~**Email-verification replay**~~ — **done in Phase 3.1**: replaced with a single-use,
   attempt-limited one-time code (ADR-021).
2. **Login throttling**, absent until Phase 15. Now the weakest item.
3. **Session lifetimes** below 30 days customer / 7 days admin.

### Validation

Format, lint, typecheck, 75 unit and integration tests, production build, and both boundary probes
all pass. Migrations were proven both ways against local PostgreSQL 18.4 — incrementally from the
Phase 2.3 database, and from empty through the full three-migration history — with the seed run on
both and `prisma migrate diff` reporting zero drift each time.

## Previous

**Phase 2.3 — Better Auth architecture locked, schema reconciled. Complete.**

---

## TASK-005: Phase 2.3 — Better Auth architecture lock and schema reconciliation

Status: DONE

Related docs: `docs/SECURITY.md` sections 2 and 2.1, `docs/DATABASE.md` sections 4 and 18,
`docs/ARCHITECTURE.md` section 7, ADR-006 (amended 2026-09-05)

> **Partly superseded by Phase 3 (TASK-006).** Kept as written, because the reasoning is the
> record of what was decided and why. Three claims below were corrected once the package was
> installed: reset tokens are now hashed at rest (ADR-020), `accounts.issuer` is `NOT NULL` and
> the account key is `(issuer, accountId)` (ADR-019), and session tokens carry ≈190 bits of
> entropy rather than 256. The plaintext-session-token decision itself stands.

### The decision, in one paragraph

**Option B.** Better Auth 1.7.2 is used with its native database-backed session and verification
model, which stores the session token and the verification/reset credential **in plaintext at
rest**, because the library looks both up by equality on the raw value. An adapter that hashed
them underneath Better Auth was considered and **rejected**: it is not a supported extension
point, it would break on any release that changes how those rows are queried, and it would break
inside an authentication path that keeps appearing to work. Hand-rolling authentication remains
rejected for the reason in the original ADR-006. Argon2id password hashing is unaffected and
stays, through Better Auth's supported custom password-hashing option, with the hash on
`accounts.password` where `providerId = 'credential'`.

### Compensating controls, mandatory not optional

256-bit CSPRNG tokens · revocation by row deletion · 24-hour email-verification and 1-hour reset
expiry · Better Auth's atomic single-use consumption · HTTPS with `HttpOnly`, `Secure`,
`SameSite=Lax` cookies · a database that is never publicly reachable, with TLS, encrypted backups
and a least-privilege role · never-log and never-serialise for `sessions.token`,
`verification.value` and `accounts.password`. Full list: `SECURITY.md` section 2.1.

### Session lifetime — unchanged

Customer 30 days, admin 7 days. **No new TTL decision was introduced in this phase.** Shortening
them is recorded as an item for the security review that follows the Phase 3 integration.

### Schema changes

`users` gained `name`, `email_verified` (boolean), `image`; `email` became NOT NULL; it lost
`password_hash`, `first_name`, `last_name` and `email_verified_at`. `sessions` swapped
`token_hash` for `token` and lost `last_active_at`. `accounts` gained the full Better Auth shape
including `password`. `verification_tokens` and its enum were replaced by the generic
`verification` table — single use is Better Auth's atomic delete-on-read, not a `consumedAt`
column, and the two designs are deliberately not kept side by side.

Migration `20260905101500_better_auth_schema`, applied on top of the Phase 2 migration. History
was not rewritten and not reset. The destructive drops are safe because the four tables are
empty: the seed creates no auth rows, and it still creates none.

Also in this change, outside the auth models: `orders.subtotal = SUM(order_items.lineTotal)` moved
out of the database-constraint list in `DATABASE.md` section 18 and is now classified as a
**service/domain invariant** in the new section 18.2, cross-referencing `BUSINESS-RULES.md`
sections 2.6.5 and 5A.6. The business rule itself is unchanged; no trigger was created and no
pricing arithmetic went into SQL.

### Validation

Format, lint, typecheck, 40 unit and database tests, migration, seed (twice, idempotent),
production build and the six-error architecture-boundary probe all pass. The migration was proven
**both** ways against the local PostgreSQL 18: incrementally from the existing Phase 2 database,
and from an empty database through the full history. Both end with `prisma migrate diff` reporting
zero drift against the schema.

### Deliberately not done

Better Auth is not installed, not configured, and there are no auth routes, no login or register
UI, no session creation, no authorisation code, no password reset and no email verification. Those
are Phase 3.

### Carried into Phase 3

- Primary keys are `uuidv7()`, so Better Auth must be configured to let the database generate ids
  rather than supplying its own.
- `accounts.issuer` is included per the integration research; confirm it against the installed
  1.7.2 schema during the spike and drop it if the library does not use it.
- The integration spike must be run against the real stack (Node 20.19+, Next.js 16, React 19,
  Prisma 7, PostgreSQL 18) before anything is built on top of it.

---

## Previous

**Phase 2 — Database Foundation. Complete.**

The schema from `DATABASE.md` exists as Prisma models and a single reproducible migration,
verified against a real PostgreSQL 18.4 from an empty database: 64 tables, 32 enums, 28 CHECK
constraints, 20 partial indexes, 105 foreign keys. The seed is idempotent and carries only
reference and configuration data. 29 unit and database tests pass.

Still no authentication, no repositories, no domain logic, no UI — those are Phases 3 onward.

---

## TASK-004: Phase 2 — Database Foundation

Status: DONE

Related docs: `docs/DATABASE.md`, `docs/BUSINESS-RULES.md`, `docs/ARCHITECTURE.md`, ADR-002,
ADR-017, ADR-018

### Delivered

- **Prisma 7.10.0** (stable; the `latest` npm tag points at an 8.0 release candidate that also
  requires Node 22+). `prisma/schema.prisma` plus `prisma.config.ts`, which is where Prisma 7
  expects connection URLs.
- **Every table, enum, relation, index and constraint in `DATABASE.md`**, including the V1.5
  tables (collections, coupons, wishlist, analytics) so no later migration is needed for them.
- **`discount_tiers`** per ADR-017, seeded 0 / 500 / 1000 / 1500 basis points.
- **Basis points throughout** per ADR-018: `depositPercent` = `5000`,
  `estimateBandPercent` = `1500`, `discount_tiers.discountBasisPoints`, and a CHECK bounding
  coupon percentages to 0–10000.
- **`prisma/sql/constraints.sql`** — the CHECK constraints and partial indexes Prisma cannot
  express, each labelled with the `DATABASE.md` section it implements, appended verbatim to the
  initial migration.
- **`src/lib/db/client.ts`** — `server-only` singleton on the pg driver adapter, pool size 1 by
  default per the documented serverless strategy.
- **Deterministic idempotent seed**: 58 wilayas, 3 shipping zones covering all 58, 6 rates,
  4 discount tiers, 15 settings.
- **22 database tests** covering the seeded values, the basis-point convention, and the
  constraints that are easiest to lose in a later migration.
- CI extended with a PostgreSQL 18 service, migrate, seed, seed-again and database tests.

### Deliberately not seeded

The demo catalogue, admin user, placements, embroidery sizes, thread colours, fonts and
customisation profile listed in `DATABASE.md` section 19 need real business content and image
assets that do not exist yet. They belong to Phases 6 and 9. Inventing them now would be the
fake production data the phase brief prohibits.

### Placeholder values, flagged

Shipping rates and `custom_orders.depositWindowDays` are structurally correct placeholders
pending the owner (open decisions 2, 3 and 5 below).

---

## Previous

**Phase 1 — Foundation. Complete, pending deployment verification.**

The application scaffold exists and is validated: format, lint, typecheck, unit tests, production
build and a six-case Playwright smoke test all pass, and the architecture boundary rules were
proven to reject a deliberate violation. There is still **no database, no authentication and no
storefront** — the page at `/` exists only to prove the build chain and is replaced in Phase 5.

Outstanding before Phase 2 can start:

- [x] Schema-affecting business decisions answered — see TASK-003 below
- [ ] Preview deployment (blocked — see TASK-002)
- [ ] Initial commit (`git init` done; no commit has been made)

---

## TASK-003: Phase 2 decision gate — locked

Status: DONE

Related docs: `docs/DATABASE.md`, `docs/BUSINESS-RULES.md`, `docs/DECISIONS.md`

A read-only gate pass identified two schema-affecting questions. Both are now locked.

### 1. Quantity discount storage — `discount_tiers` table

Tiers are rows in a dedicated table, **not** a JSON settings value. They are ordered, range
constrained, admin-edited and queried, which is exactly what the project's JSON rule
(`AGENTS.md` section 7, `DATABASE.md` section 16) says belongs in a relational table.

Seeded V1 tiers, unchanged from the documented values:
1–9 → 0% (`0`) · 10–24 → 5% (`500`) · 25–49 → 10% (`1000`) · 50+ → 15% (`1500`).

Recorded as **ADR-017**. Table defined in `DATABASE.md` section 12.

### 2. Percentage representation — integer basis points

Every percentage in a business calculation is an integer count of basis points
(10 000 = 100%). Fractions such as `0.5` are prohibited.

This resolved a real contradiction: coupons used basis points (`value / 10000`) while the deposit
formula used a fraction (`grandTotal * depositPercent`). The deposit is now
`applyBasisPoints(grandTotal, depositPercent)` with `depositPercent` seeded as `5000`.

Recorded as **ADR-018**. Convention in `BUSINESS-RULES.md` section 1.6.

### Also documented

The two settings keys the gate found missing, plus two that were referenced in rules but never
named. `DATABASE.md` section 14 now carries an **exhaustive** `custom_orders` settings table:

`quoteThresholdThreadColors` (3) · `quoteThresholdInstructionLength` (200) ·
`maxThreadColors` (8) · `estimateBandPercent` (1500).

Note the two distinct thread-colour limits, which must not be conflated: **3** is where a
configuration needs a human quote; **8** is where it cannot be configured at all.

### Values confirmed unchanged

Deposit **50%** · quote validity **14 days** · acceptance validity **7 days** ·
fixed-price thresholds **3 colours / 10 units / <200 characters** ·
discount tiers **0 / 5 / 10 / 15%**.

Only representation and storage changed. No business rule was redesigned.

---

## TASK-002: Phase 1 — Foundation

Status: DONE, except deployment

Related docs: `docs/ARCHITECTURE.md`, `docs/DESIGN-SYSTEM.md`, `docs/SECURITY.md`, `docs/ROADMAP.md`

### Delivered

- Next.js 16.3.4 App Router, React 19.2.8, TypeScript 6.0.3 strict with
  `noUncheckedIndexedAccess`
- Layer skeleton per `ARCHITECTURE.md` section 17, documented in `src/ARCHITECTURE.md`
- Tailwind 4 bound to the CSS custom-property token system: `src/styles/tokens.css` is the only
  place raw design values exist; components use semantic roles only
- `src/config/brand.ts` — brand replaceable by editing two files
- `src/lib/env.ts` — Zod-validated, server/client split, server values unreachable in the browser
- ESLint architecture boundaries, enforced and verified (see `tests/README.md`)
- Prettier, Vitest 4, Playwright, CI on Node 20.19 and 22
- `sharp` 0.35.4 pinned and verified encoding AVIF and WebP
- Foundation security headers; nonce-based CSP deferred to Phase 15 as documented
- Database connection strategy documented in `ARCHITECTURE.md` section 18 — no schema created

### Deferred deliberately

- Prisma is **not** installed. Phase 2 installs it; the connection contract is documented.
- Nonce CSP, rate limiting, auth, storage — the phases that own them.

---

## Previous

**Phase 0 — Product & Architecture Analysis**

- **Application implementation has NOT started.** There is no Next.js application, no
  dependencies, no database schema, no pages, no components, no API routes, no authentication,
  no custom builder and no admin dashboard.
- **The current objective is documentation and architecture only** — converting the complete
  product specification into a persistent knowledge base that future sessions read instead of
  reloading the original specification.
- **The required documentation files must be completed** before any implementation begins.
- **The next phase will be Phase 1 — Project Foundation.**

---

## Active Tasks

## TASK-000: Phase 0 — Product & Architecture Analysis

Status: DONE

Related docs: all of `docs/`

### Context

The repository was empty apart from scaffolding. Before any code is written, the specification
had to be analysed and converted into the documentation set that becomes the project's source of
truth, so that later sessions can work from focused documents rather than a 35 KB specification.

### Scope

In scope, and completed:

- [x] `docs/PRODUCT.md` — business model, customers, commercial flows, goals, features,
      capabilities, improvements, assumptions, V1 scope, future capabilities
- [x] `docs/UX.md` — sitemap, navigation, journeys, builder, quote, checkout, account, admin,
      conversion, friction, mobile, loading/empty/error/success states
- [x] `docs/ARCHITECTURE.md` — stack, layered architecture, Next.js strategy, server/client
      boundaries, domain, data access, auth, authorisation, storage, payments, notifications,
      validation, actions vs routes, errors, caching, performance, scalability, structure
- [x] `docs/DATABASE.md` — entities, fields, relationships, enums, constraints, indexes,
      ownership rules, JSON policy, seed data
- [x] `docs/BUSINESS-RULES.md` — money, pricing, discounts, shipping, totals, three lifecycles,
      stock, availability, permissions, file rules, ownership, admin behaviour, centralisation
- [x] `docs/DESIGN-SYSTEM.md` — direction, brand replaceability, typography, colour, spacing,
      layout, radius, shadows, components, motion, responsive rules, accessibility
- [x] `docs/SECURITY.md` — threat model, auth, authorisation, IDOR, validation, file and SVG
      security, private storage, signed URLs, sessions, rate limiting, CSRF, data protection,
      admin protection, pre-launch checklist
- [x] `docs/ROADMAP.md` — V1 / V1.5 / V2 split and 18 implementation phases with entry
      conditions and definitions of done
- [x] `docs/DECISIONS.md` — 14 architectural and product decisions
- [x] `CLAUDE.md` — handoff notes for future sessions

Explicitly out of scope for this phase, and not done:

- Creating the Next.js application
- Installing application dependencies
- Creating the Prisma or Drizzle schema
- Building pages, components, API routes or server actions
- Building authentication, the custom builder, or the admin dashboard

### Definition of Done

- [x] All nine documentation files written and internally consistent
- [x] Deviations from the original specification documented, not applied silently
- [x] Assumptions stated explicitly (`PRODUCT.md` section 10)
- [x] V1 scope unambiguous (`PRODUCT.md` section 11, `ROADMAP.md` section 1)
- [ ] Reviewed and approved by the project owner

---

## TASK-001: Architecture review corrections

Status: DONE

Related docs: all of `docs/`, plus `CLAUDE.md`

### Context

A pre-Phase-1 review checked the twelve most significant Phase 0 decisions against the original
specification. The load-bearing decisions held; the review found gaps between rules stated in one
document and their representation in the schema, several of which would have been expensive or
impossible to repair after Phase 2.

### Scope

Twenty-two corrections applied across the documentation. The structural ones:

- [x] `FEE` line kind, and the exhaustive quote-line to order-line mapping
- [x] Quote-bound carts, exclusive and non-mutable
- [x] Customisations freeze at quote **send**, with clone-on-edit
- [x] Display snapshots on frozen customisations; reference data deactivated, never deleted
- [x] `product_image_placement_anchors` added; preview narrowed to PNG and JPG
- [x] Guest checkout requires email; customer directory is a users-plus-guest-phone union
- [x] `shipping_rates.freeOverAmount` is the sole runtime free-delivery source
- [x] `orders.shippingRateId` and `shippingRateLabel` snapshots
- [x] Deposit copied from the quote, never recomputed; offline deposit flow documented
- [x] Quote acceptance validity window (default 7 days)
- [x] `QUOTED -> NEEDS_INFO` allowed; `NEEDS_INFO` distinguished from conversation
- [x] Better Auth scoped to authentication only; authorisation stays in `domain/permissions`
- [x] Transactional email and admin notifications moved into V1 (Phase 8A added)
- [x] Multi-item requests via "Add another product"; size breakdown documented as a limitation
- [x] Single-fulfilment-unit limitation documented; partial shipment explicitly not V1
- [x] Blanks default to `MADE_TO_ORDER`; post-acceptance unavailability has a recovery path
- [x] Recent Customers on the admin dashboard; `brand.logoKey` editable logo
- [x] Guest reviewing documented as an accepted consequence
- [x] Phase 1 scope gained connection pooling and `sharp` verification

New decisions recorded: **ADR-015** (quote-bound carts and the `FEE` line kind) and **ADR-016**
(historical fidelity). Amended: ADR-005, ADR-006, ADR-010, ADR-011.

### Definition of Done

- [x] Every correction applied and cross-referenced between documents
- [x] Contradictions introduced by the corrections resolved, not left competing
- [ ] Reviewed and approved by the project owner

---

## Blocked / Waiting On

- **TASK-002 — preview deployment.** Blocked on access, not on code. The machine has no Vercel
  CLI, no Vercel authentication, no `gh` CLI and the repository has no remote. The production
  build and production server are verified locally (Playwright drives a real `next build` plus
  `next start`), but "preview is reachable" cannot be claimed without deploying.

  Remaining steps, in order:

  ```bash
  git add -A && git commit -m "Phase 1: project foundation"
  gh repo create <owner>/stitch --private --source=. --push   # or add a remote by hand
  npx vercel link
  npx vercel env add NEXT_PUBLIC_SITE_URL preview             # e.g. https://stitch-<hash>.vercel.app
  npx vercel env add NEXT_PUBLIC_SITE_URL production
  npx vercel deploy
  ```

  `NEXT_PUBLIC_SITE_URL` must be set in the Vercel project before the first build, or the build
  fails by design.

- **Phase 2 gating.** Phase 2 must not begin until the schema-affecting open business decisions
  below are answered.

---

## Notes

### Open business decisions

Recorded rather than invented. None blocks Phase 1.

1. ~~**Deposit percentage for custom orders.**~~ — **settled at 50%**, seeded as `5000` basis
   points (ADR-008, ADR-018). The owner may change it from the admin before launch; no code or
   schema change is involved.
2. **Bank and CCP account details, and the customer-facing payment wording**
   (`BUSINESS-RULES.md` section 8.10). Needed before Phase 8. The flow is specified; the account
   details and copy are not invented here.
3. **`depositWindowDays`** — how long an unpaid deposit order stays open before the admin is
   prompted to follow up. Needed before Phase 8.
4. **Recovery policy when a stock-tracked blank becomes unavailable after quote acceptance**
   (`BUSINESS-RULES.md` section 10.9.3). V1 blocks, explains, preserves the cart and escalates to
   the admin. Whether the business substitutes an equivalent blank, absorbs a price difference, or
   always reissues a quote is the owner's call. Needed before Phase 10.
5. **Shipping rates per zone**, home versus desk, and per-rate free-delivery thresholds.
   Placeholders seeded in Phase 2; real values needed before launch.
6. ~~**Fixed-versus-quote thresholds**~~ — **settled at the documented defaults** (10 units,
   3 colours, 200 characters) and given named settings keys. Tunable from the admin after launch;
   revisit once real funnel data exists, since this is the lever that decides how much of the
   funnel self-serves versus queues for the owner.
7. ~~**Quantity discount tiers**~~ — **settled** at 0 / 5 / 10 / 15% in `discount_tiers` (ADR-017).
8. ~~**Quote validity and acceptance validity**~~ — **settled** at 14 and 7 days.
9. **Stated response time** shown to customers. Documented at 6 working hours — note this is a
   promise the business must be able to keep, now that admin notifications support it.
10. **Real brand identity.** STITCH is a placeholder; replacement is `config/brand.ts`,
    `styles/tokens.css` and the `brand.logoKey` setting.
11. **Interface language.** V1 is single-locale French. If Arabic is needed at launch rather than
    in V2, that changes Phase 1 and must be decided before it.

### Known V1 limitations, deliberately accepted

Documented so nobody promises them to a customer:

- Partial shipment is not supported; an order ships once (`BUSINESS-RULES.md` 8.9).
- No visual preview for SVG or PDF uploads (ADR-011).
- No dedicated size-breakdown control; multiple sizes means multiple request items (`UX.md` 5).
- Guest purchasers cannot review until they claim their order (`BUSINESS-RULES.md` 11A.4).
- Deposits are collected offline and confirmed by hand; no payment provider is integrated.

Repository housekeeping to complete during Phase 1:

- The project root is still the placeholder directory `your-project/` and should be renamed.
- The repository is not under version control; `git init` has not been run.
- The empty `complete_product_specification.md` at the parent level should be replaced with the
  real specification file, kept for reference. `/docs` is now the working source of truth.

---

## Recent Completion Summary

- Read `AGENTS.md`, `CLAUDE.md` and the scaffold documentation.
- Analysed the full 63-section product specification.
- Authored nine documentation files plus `CLAUDE.md` as the project's source of truth.
- Recorded 14 decisions, including 13 deliberate deviations from the original specification,
  summarised in `PRODUCT.md` section 9.

---

## Next Phase

**Phase 8A — Transactional notifications**, or **Phase 13 — Reviews, gallery and content**
(`ROADMAP.md` section 2).

Phase 8A is the stronger candidate, because everything now in place assumes it. Nothing is sent
when a request arrives, when a quote is about to expire, when an order is confirmed or when a
deposit is received — the workshop's six-hour response promise currently depends on somebody
remembering to open `/admin`, and a customer learns their order shipped by checking the portal.

Ahead of either, three gaps are worth naming because each blocks something real:

- **Admin catalogue management** (Phase 6). The catalogue is still whatever the seed wrote, and no
  photograph exists.
- **The scheduled jobs** (Phase 8A). The two quote sweeps and the stale-upload reaper are
  functions nothing calls. The lazy checks mean nothing is *wrong*, only that stored statuses lag.
- **User management** (Phase 12's remainder). Making somebody staff is a database update.

Phase 11 leaves two things a customer will meet:

- **No address book, and no way to edit a name or a password.** The profile page states this
  plainly rather than showing controls that do nothing.
- **No guest-order claiming.** An order placed without an account stays reachable by its e-mailed
  link and is absent from the portal until the claiming flow exists.

And three the business will:

- **No admin order workspace**, so `order_status_history` is written by nothing and a customer's
  order timeline is one line long.
- **No recorded payments**, so every order's payment card reads "non réglée".
- **No scheduled expiry**, still. The two quote sweeps are functions; Phase 8A brings the cron,
  and the lazy checks mean nothing is wrong until then.

Phase 10 leaves three things a customer will meet before Phase 11 finishes:

- **No account overview, no order or request lists, no sign-out.** The header has one account
  link, and it goes to the quotes list.
- **No verification or password-reset screen.** Both flows exist and neither has a page, and
  acceptance requires a verified address.
- **No guest claiming.** A guest who asked for a quote must register with the same address before
  the quote can be issued to them at all.

And two the business will:

- **No scheduled expiry.** The two sweeps are functions; Phase 8A brings the cron. The lazy checks
  mean nothing is *wrong* until then, only that stored statuses lag.
- **No order workspace.** An accepted quote becomes an order through the customer's checkout, and
  from there the Phase 8 state machine has nothing driving it.

Three things are unfinished and each blocks something later:

- **Admin catalogue management** (Phase 6) — product CRUD, image upload, variant generation, stock.
  Without it the catalogue is only ever what the seed put there.
- **Listing controls** (Phase 6) — search, filter, sort, pagination on `/shop`.
- **Multi-item requests and draft persistence** (Phase 7) — `custom_request_items` already supports
  several items and the service writes one; drafts are documented in `UX.md` section 5.

A fourth is now outstanding too:

- **The admin order workspace** (Phase 8) — the status transitions, the deposit confirmation and
  the `CONFIRMED` transition that takes the deferred stock reservation. The state machine and the
  derived payment status exist and are tested; nothing drives them yet.

A fifth is outstanding after Phase 9:

- **The rest of the builder** (Phase 9) — the design-on-product preview of ADR-011, URL-addressable
  steps, draft persistence and multi-item requests. The upload pipeline they all sit on top of is
  built and tested.

What Phase 8 and Phase 9 hand over:

- **A storage boundary.** `lib/storage` is the whole provider decision; the S3 adapter is the only
  file that knows what R2 is. Phase 9's own limitation is that it has never run against a real
  bucket — provisioning one and doing a single end-to-end upload is a launch prerequisite.
- **A verified-file pipeline** the quote flow can rely on: an admin opening a design file in
  Phase 10 is opening something the server has already read and vouched for.


- **One totals pipeline.** `server/services/cart-pricing` is the only path from a cart to a
  number, and the cart, the checkout and placement all call it.
- **A placement transaction worth copying.** Claim the cart to make a double submission
  impossible, reserve conditionally so a race cannot oversell, take the number from a sequence,
  write everything or nothing.
- **Sequence-backed identifiers.** `quoteNumber` is the last one without a sequence; Phase 10
  should add `quote_number_seq` beside the other two rather than inventing a third mechanism.
- **A quote-bound checkout that already obeys section 5A**, waiting for the acceptance flow that
  produces such a cart.
---

## Task Template

```
## TASK-XXX: [Short Title]

Status: TODO | IN PROGRESS | BLOCKED | DONE

Related docs: [...]

### Context
Why this task exists.

### Scope
What will be done and what won't.

### Checklist
- [ ] Subtask 1
- [ ] Subtask 2

### Definition of Done
- [ ] Code merged
- [ ] Tests passing
- [ ] Docs updated
```
