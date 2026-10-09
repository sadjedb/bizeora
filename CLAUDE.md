# CLAUDE.md

Handoff notes for Claude Code and other AI assistant sessions.
Working rules are in `AGENTS.md`. This file is orientation only.

## Project Context

**Bizeora** — a custom embroidery ordering platform, e-commerce store,
customer portal and admin dashboard for a small embroidery business in Algeria.

**Current state: Phases 0 to 14.15 are complete, Phase 8A included, Phase 15 partly, and Phase 16
— the redesign — through 16.5.** The application is real and
runs end to end. A visitor can browse the shop and the gallery, configure an embroidery, submit a
request, receive a quote, accept it, check out, follow the order from their account and review what
was delivered; the workshop can create and price the products it sells, hold stock for them, price
and send a quote, move the order through its statuses, record the payment, keep private notes and
moderate reviews. Both sides are told by e-mail when something happens to them.

What exists, in one paragraph each layer: Next.js 16 with a bilingual public site under
`(site)/[locale]` — every page is `/fr/…` or `/en/…` — an `/account` portal inside it and an
unprefixed `/admin` workshop in its own route group, in either language; Prisma 7 over PostgreSQL 18 with ten
migrations;
Better Auth for credentials and sessions only; a design system of 34 primitives on CSS
custom-property tokens; `domain/` holding pricing, totals, three state machines and every
permission predicate; private object storage behind `lib/storage`; a notification outbox with a
dispatcher behind `POST /api/jobs/notifications`; a homepage composed from `homepage_sections`
rows rather than literals (ADR-027); `sitemap.xml`, `robots.txt`, canonicals, `hreflang` and
JSON-LD, behind a deployment-wide indexing switch that is off until launch (ADR-028); a
sidebar-shelled admin whose every list is a table, catalogue write screens, and a stock ledger
(ADR-029); two typed dictionaries driving the whole application (ADR-030, ADR-033) and a
light/dark palette declared with `light-dark()` (ADR-031); and, since Phase 14.8, product
photography uploaded from the admin into the one public storage prefix (ADR-032) and an editor for
the front page at `/admin/content`; since Phase 14.9, multi-select and archiving in every
workshop list (ADR-034); since Phase 14.10, a customer who drags their artwork onto a photograph of
the garment and sizes it there, stored as four percentages in texture space and drawn back for the
workshop (ADR-035, ADR-036); since Phase 14.11, a checkout that asks for a size once and an e-mail
address never; since Phase 14.12, a settings screen at `/admin/settings` that renames the
shop, closes it to the public and switches e-mail verification off (ADR-037, ADR-038); and,
since Phase 14.13, a catalogue that can be searched, filtered, ordered and paged — every
narrowing an address rather than component state — with category listings at `/shop/c/[category]`
and a screen in the workshop that creates them (ADR-039); and, since Phase 14.14, a **bilingual
catalogue**: product names, descriptions, category names, gallery captions and the banner carry an
English overlay with French as the per-field fallback, written from an English panel on the same
forms (ADR-040); and, since Phase 14.15, a **3D view of the garment** on the product page, with the
customer's design composited into the model's UV map by the same transform that places it on a
photograph, `three` loaded only when somebody asks for it, and a card in the workshop that attaches
a `.glb` after parsing it; and, since Phase 15, a **nonce-based Content-Security-Policy** set in
the middleware and **rate limiting** on login, registration, design upload and the guest order
lookup (ADR-041).

**What is not built** — and must not be assumed — is the rest of Phase 12's outstanding admin half
(gallery curation, the audit-log viewer, admin dark mode, the guest half of the customer
directory), the `pages`- and `faqs`-backed storefront routes, a configured e-mail provider (the transport is real; no key is
set, so the development transport logs and delivers nothing), a cron entry calling the dispatcher,
**a screen for entering an e-mail verification code or resetting a password** (both flows exist
since Phase 3.1; neither has a customer-facing screen),
**real photography** (the pipeline is
built and the files in `public/assets` are placeholders — the owner supplies the pictures),
a dark admin, and every V1.5/V2 feature. **The site is not indexable until `SEO_INDEXABLE=true` is set** — that is deliberate
(ADR-028) and Phase 18 sets it. The authoritative list of what each phase deliberately left out is in `tasks/CURRENT.md`,
phase by phase.

**Next phase: see `tasks/CURRENT.md`.** It is the only file that is kept current; this one is
orientation and goes stale between phases.

The documentation was reviewed before implementation and 22 corrections applied. The decisions
that came out of that review are ADR-015 and ADR-016, plus amendments to ADR-005, ADR-006, ADR-010
and ADR-011. If something in the docs looks surprising, check those first — it is probably
deliberate. Forty-three ADRs exist in total.

## Read This First

Always start with `tasks/CURRENT.md`. Then read **only** the documentation relevant to the task
in hand — not all of it. The documents are deliberately separated so a session never has to load
the whole specification.

| Working on                               | Read                     |
| ---------------------------------------- | ------------------------ |
| Anything                                 | `tasks/CURRENT.md`       |
| Product scope, what is in V1             | `docs/PRODUCT.md`        |
| Screens, flows, states, copy             | `docs/UX.md`             |
| Stack, layers, boundaries, caching       | `docs/ARCHITECTURE.md`   |
| Schema, fields, indexes, ownership       | `docs/DATABASE.md`       |
| Pricing, totals, lifecycles, permissions | `docs/BUSINESS-RULES.md` |
| Any UI work                              | `docs/DESIGN-SYSTEM.md`  |
| Auth, uploads, access control            | `docs/SECURITY.md`       |
| What to build next, phase scope          | `docs/ROADMAP.md`        |
| Why something is the way it is           | `docs/DECISIONS.md`      |

The original 35 KB specification is at `../complete_product_specification.md`. It is historical
reference. Where it and `/docs` disagree, `/docs` wins — the deviations are deliberate and are
listed in `PRODUCT.md` section 9 with reasoning in `DECISIONS.md`.

## The Rules That Matter Most

1. **Business logic lives in `domain/`, once.** Pricing, totals, discounts, shipping, deposits and
   all three state machines. Pure functions, no I/O, unit tested. Never recompute a price in a
   component, an action or the admin. `BUSINESS-RULES.md` section 16 lists everything that must be
   centralised.
2. **Only `server/repositories/` imports Prisma**, and every customer-scoped query filters by
   `userId` inside the query, never after the fetch.
3. **Never trust the client** — not the price, the total, the status, the content type, or the
   user ID. Every mutation is validated server-side.
4. **Customer design files are private by default**, always. Private bucket, no public access,
   short-lived signed URLs after an authorisation check, access audit-logged.
5. **One order pipeline.** Custom orders are orders whose line items carry a customisation.
   There is no parallel custom-order system. See ADR-003.
6. **An accepted quote is a commitment, not a cart.** It gets its own quote-bound cart: nothing
   added, nothing edited, no coupons, quoted shipping, and the order total must equal the quote
   total exactly. Fees survive as `FEE` line items. See ADR-015.
7. **A customisation freezes when its quote is sent**, and writes display snapshots. Editing a
   frozen configuration clones it. Historical rendering uses the snapshots, never the reference
   tables. See ADR-010 and ADR-016.
8. **Money is an integer of minor units.** Never a float. See ADR-012.
9. **No component contains a literal colour, font, radius or shadow.** Tokens only, and every
   token names both its light and its dark value on one line with `light-dark()`. Never mute a
   colour with `opacity`; never hard-code an inversion. The brand lives in `config/brand.ts`
   alone.
9A. **No component contains a literal sentence either.** All copy — storefront *and* workshop —
   lives in `i18n/dictionaries`; French is the source of truth and the type, so a missing English
   string is a build error. A storefront server component reads `params.locale`, an admin one calls
   `workshopDictionary()`, and any client component calls `useDictionary()`. Never write a language
   prefix into an `href` — `Link` adds it. See ADR-030 and ADR-033.
9B. **Shop imagery is public and re-encoded; customer artwork is private and untouched.** They are
   different domains (`domain/media` and `domain/design-file`) on purpose. Never write to the
   `media/` prefix without decoding the bytes first. See ADR-032.
9C. **A storefront cache is invalidated by the name it was stored under, and the failure to do so
   is silent.** A prerendered page carries the tags Next derived from its *internal* route, route
   groups included — `/fr` is stored under `_N_T_/fr` and `_N_T_/(site)/[locale]/layout`, and under
   nothing else. So: one page, one language, use the concrete path with **no** type —
   `revalidatePath('/fr/shop')`. A whole subtree, both languages, name the layout **with its route
   group** — `revalidatePath('/(site)/[locale]', 'layout')`. Never `/fr` with `'layout'` and never
   `/[locale]/shop`: both are well-formed, match nothing, and report success. See ADR-038.
9D. **The workshop archives; it never deletes.** `archived_at` hides a row from the admin's own
   lists and from nothing else — no customer query reads it, and it is not `deleted_at`. Every new
   admin list query filters through `archiveWhere()`; one that forgets shows archived rows
   silently. A published product is never archived from a checkbox. See ADR-034.
9E. **A placement is four percentages and a face, never pixels and never
   millimetres.** The same transform positions a design over a photograph and
   inside a 3D model's UV map. Millimetres are derived server-side from
   `product_images.surface_width_mm`, which only the workshop can set — a
   millimetre figure from a browser is a price the browser chose. See ADR-035.
9F. **A published `.glb` is parsed before a byte is stored, and refused if it
   references anything outside itself.** `models/` is public, so "verify
   afterwards" means serving a model that fetches from someone else's host.
   See ADR-036.
9G. **The shop closes at the `(storefront)` layout, and sign-in is not part of the shop.**
   `site.storefrontEnabled` is read there, once, and `/login` sits in the `(entrance)` group
   outside it so that closing the shop cannot lock the owner out of `/admin`. Nothing reads a
   cookie in that decision — a request-specific read inside a prerendered route is a 500, not a
   stale page. See ADR-038.
9H. **The catalogue is translated by an overlay, and French is the fallback.** A row's
   `translations` column holds `{"en": {…}}`; `localise(row, overlay, locale, fields)` merges it at
   the **repository boundary**, so a page never translates anything itself. Name the fields — an
   overlay is written by a form, and merging it wholesale is a way to set a price. Blank means "not
   translated", never "translated to nothing". See ADR-040.
9I. **Nothing under the storefront layout is prerendered, and an inline script carries a nonce.**
   The Content-Security-Policy is built per request in `src/middleware.ts`; a component that
   renders an inline `<script>` reads its nonce from `lib/security/nonce`, which makes the route
   dynamic — that is what a nonce is, not a bug to work around. Never add `'unsafe-inline'` to
   `script-src`. See ADR-041.
9J. **A rate limit is a business rule.** The limits live in `domain/rate-limit` next to the
   deposit percentage, not in the storage client; `throttle` is the one line an action calls.
   Counting happens **before** the decision, so two simultaneous requests cannot both pass a limit
   of one. `SECURITY.md` section 9.
9K. **The storefront is rounded; the workshop is not.** `--radius-xl` and `--radius-2xl` are for
   photographic frames and floating surfaces only, and `Button`'s `shape` defaults to `tight` so
   the admin never changed. A component shared by both halves has to be told which side it is on.
   See ADR-042.
9L. **The embroidery preview is a rendering, never a file.** The stitch effect runs in the
   browser, on a copy, for display; the stored artwork stays byte-for-byte what the customer sent
   (ADR-024), and the workshop is shown the original because it has to digitise it. The model is
   in `domain/embroidery` and the canvas work in `lib/embroidery` — the same split as
   `domain/media`. See ADR-043.
9M. **One word in a headline is emphasised, and which word is content.** The row says
   `Vos idées, *brodées.*`; `headingSegments` splits it. It cannot be code, because the emphasised
   word is in a different position in each language. One pair of asterisks is the only markup the
   system understands, and nothing else in the field is interpreted.
10. **Authentication and authorisation are separate.** Better Auth does credentials and sessions
    only; every permission decision lives in `domain/permissions`, and no Better Auth type leaves
    `lib/auth/`. See ADR-006.
11. **Do not build V1.5 or V2 features during V1**, including opportunistically.

## Common Tasks

- **Starting a phase**: read `tasks/CURRENT.md`, then the phase's entry in `ROADMAP.md` section 2,
  then only the docs that phase needs. Plan the smallest coherent change, implement, validate
  against the phase's definition of done.
- **Adding a feature**: check `ROADMAP.md` first — if it is V1.5 or V2, do not build it.
- **Changing the schema**: `DATABASE.md` is the design source of truth and must be updated in the
  same change as the migration.
- **Changing a business rule**: change `domain/`, update `BUSINESS-RULES.md`, update the tests.
- **Making an architectural decision**: add an ADR to `DECISIONS.md` using the existing format.
  Only for decisions that are non-obvious or costly to reverse.
- **UI work**: use the tokens and components in `DESIGN-SYSTEM.md`. Do not invent a component that
  already exists, and do not introduce a colour.

## Reminders

- Every screen needs loading, empty, error and success states before it is finished.
- Mobile is the primary platform, not an adaptation.
- Update the relevant documentation in the same change that alters behaviour.
- When the specification, the docs and the code disagree, the code is what ships — inspect it
  before assuming a feature is missing.
