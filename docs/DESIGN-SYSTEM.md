# DESIGN-SYSTEM.md

> The visual system for **Bizeora**.
> Interaction flows are in `UX.md`. This file defines what things look like and why.

---

## 1. Direction

**Premium fashion brand + craftsmanship + modern technology.**

The system is built on three ideas held in tension:

| Idea           | Expression                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Craft**      | Warm neutrals, paper and thread references, a serif with real character, generous whitespace, macro photography of stitching     |
| **Fashion**    | Editorial layout, restraint, near-black primary actions, tight corner radii, typography carrying the hierarchy instead of colour |
| **Technology** | A monospaced technical layer for SKUs, order numbers and specifications; precise alignment; fast, purposeful motion              |

### It must not read as

- **Generic e-commerce** — no rounded blue buttons, no primary-blue links, no coloured gradient
  hero, no star-rating badge clutter, no "SALE!" starbursts.
- **Generic SaaS** — no purple gradients, no glassmorphism, no floating cards on a grey field,
  no icon-plus-heading feature grid with three columns of identical filler.
- **Cheap local business** — no drop shadows on everything, no centred text everywhere, no stock
  photography of people shaking hands, no rainbow of accent colours.
- **A template** — the layout is not a repeating stack of identical full-width sections with
  alternating background colours.
- **A school project** — no default Bootstrap-ish spacing, no unstyled form controls, no
  inconsistent radii or arbitrary one-off colours.

### The single strongest signal

Near-black primary buttons on bone, with the accent used sparingly and typography doing the work.
Colour restraint is what separates a premium label from a marketplace.

### What Phase 14.5 changed, and why

The first execution of this direction failed in ways worth recording, because they are the failure
modes a system like this has.

- **The palette drifted warm.** Written down as "warm neutrals", built as a sepia wash. Section 4
  cooled the whole ramp and moved the accent from ochre to madder so it separates from the ground
  instead of blending into it.
- **The homepage hero was a band, not a screen.** A two-column block inside the page's normal
  rhythm, competing at the same weight as the section under it. It is now full-bleed and a hair
  under the viewport (`100svh`, not `100vh` — a mobile toolbar makes `vh` taller than the screen
  and pushed the primary call to action under the fold).
- **The admin was cards all the way down.** Seven queues, each in a bordered card with a header and
  a bulleted list. Section 12 now says tables, and says why.
- **Tokens were referenced that did not exist.** `bg-bg-sunken` appeared in eight components and
  compiled to nothing. A design system is only a system if the names resolve.

---

## 2. Brand Replaceability

The brand must be replaceable by editing two files, never by a search across components. That was
not theoretical: the placeholder STITCH became Bizeora in Phase 14.8, and it cost `config/brand.ts`
and one asset.

```
config/brand.ts        name, legal name, tagline, logo assets, social handles, contact
styles/tokens.css      every colour, font, radius, shadow and spacing token
```

**Rules**

- No component contains a literal colour, font family, radius or shadow. Everything is a CSS
  custom property, surfaced to Tailwind through the theme configuration.
- The brand name never appears as a literal string in a component. It is read from `config/brand.ts`
  or from the `brand.name` setting.
- The logo is a single component with `wordmark` and `mark` variants that renders from
  `config/brand.ts`. Swapping the logo is swapping an asset.
- The colour system is defined as semantic roles (`--color-fg`, `--color-accent`), never as
  literal names (`--ochre-500` is a raw scale value; components use the role, not the scale).
  A rebrand redefines the roles.

---

## 3. Typography

Three families, each with a clear job. Self-hosted, subset, `font-display: swap`, preloaded.

| Role          | Family                    | Fallback stack                                  | Used for                                                                             |
| ------------- | ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Display**   | Fraunces (variable serif) | `Georgia, 'Times New Roman', serif`             | Hero headlines, section titles, product names on detail pages, editorial pull quotes |
| **Text / UI** | Instrument Sans           | `-apple-system, 'Segoe UI', Roboto, sans-serif` | Everything else: body, navigation, buttons, forms, tables                            |
| **Technical** | JetBrains Mono            | `ui-monospace, 'SF Mono', Consolas, monospace`  | Order numbers, SKUs, quote references, specification labels, prices in admin tables  |

The serif carries craftsmanship. The grotesque carries clarity. The mono carries the technology
side and, in practice, makes an order number instantly recognisable as an identifier. The trio is
distinctive without being fashionable-for-its-own-sake, and each has a genuine job — the fastest
way to look like a template is three fonts chosen for variety.

**Fraunces axes**: `opsz` scales with size, `SOFT` at 20 for warmth, `WONK` at 0 for headings and
1 only for the hero — enough character to be recognisable, not enough to be a costume.

### Scale

Fluid between 375 px and 1440 px viewports.

| Token         | Min  | Max  | Line height | Tracking | Family               |
| ------------- | ---- | ---- | ----------- | -------- | -------------------- |
| `display-2xl` | 40px | 88px | 0.95        | −0.03em  | Display              |
| `display-xl`  | 34px | 64px | 1.0         | −0.025em | Display              |
| `display-lg`  | 28px | 44px | 1.08        | −0.02em  | Display              |
| `display-md`  | 24px | 32px | 1.15        | −0.015em | Display              |
| `heading-lg`  | 20px | 24px | 1.25        | −0.01em  | Text, 600            |
| `heading-md`  | 17px | 18px | 1.35        | −0.005em | Text, 600            |
| `heading-sm`  | 15px | 15px | 1.4         | 0        | Text, 600            |
| `body-lg`     | 17px | 18px | 1.6         | 0        | Text, 400            |
| `body`        | 15px | 16px | 1.6         | 0        | Text, 400            |
| `body-sm`     | 13px | 14px | 1.55        | 0        | Text, 400            |
| `caption`     | 12px | 12px | 1.4         | 0.01em   | Text, 500            |
| `overline`    | 11px | 11px | 1.2         | 0.14em   | Text, 600, uppercase |
| `mono`        | 13px | 13px | 1.4         | 0        | Technical            |
| `mono-sm`     | 11px | 11px | 1.35        | 0.02em   | Technical            |

### Rules

- Body copy never exceeds **68 characters** per line. Editorial paragraphs sit at 60–65.
- One `display-2xl` per page, at most. Usually the hero.
- `overline` marks section eyebrows ("01 — Choose your product", "OUR WORK"). It is the system's
  most recognisable typographic signature and must not be overused: one per section.
- Numerals: tabular in tables, prices and quantities; proportional in prose.
- Never centre a paragraph longer than two lines.
- Never use the display serif below 20 px; it loses its optical sizing and reads as a mistake.

---

## 4. Colour

> **Revised in Phase 14.5.** The first direction was warm to the point of sepia and the accent sat
> close enough to the neutrals to stop reading as an accent. The strategy below is unchanged; the
> values are not. `styles/tokens.css` is the source of truth and this section describes it.

### Strategy

A near-monochrome neutral system with **one** accent. The accent appears on roughly 5% of any given
screen. Photography supplies the colour; the interface supplies the frame.

Primary actions are **ink**, not accent. This is the deliberate fashion-house move and the single
decision that most separates this from a generic store.

### Raw scales

```css
/* Ink — a near-neutral graphite with the faintest warm cast.
 * Cooled in Phase 14.5: the previous ramp leaned brown (#7a7268, #d8d2c8) and
 * read as a sepia filter over the interface. The atelier direction needs a
 * ground closer to gallery-wall neutral so the work carries the colour. */
--ink-950: #100f0e;
--ink-900: #1a1917;
--ink-800: #2c2a27;
--ink-700: #423f3b;
--ink-600: #5b574f;
--ink-500: #6c675e; /* the contrast floor for the smallest type — see section 14 */
--ink-400: #96918a;
--ink-300: #b8b3ab;
--ink-200: #d5d0c8;
--ink-100: #e7e3dc;
--ink-50: #f2f0ea;

/* Paper — bone grounds, one step cooler than the previous warm off-whites */
--paper-0: #ffffff;
--paper-50: #faf9f6;
--paper-100: #f4f2ed;
--paper-200: #eae7e0;

/* Thread — the accent: one dyed madder.
 * Shifted from the previous ochre/terracotta (#9a4e26), which was close enough
 * to the warm neutrals to read as part of the ground. Madder is redder and
 * darker: it separates cleanly from bone and is unmistakably a dye. */
--thread-900: #46180f;
--thread-800: #642619;
--thread-700: #8a3623;
--thread-600: #a5462f;
--thread-500: #bd6144;
--thread-400: #d28f76;
--thread-300: #e5bcaa;
--thread-200: #f0d8cc;
--thread-100: #f9ece5;

/* Status — deliberately desaturated: an operations screen shows twenty badges
 * at once and must not read as a rainbow. */
--success-700: #1d5439;
--success-100: #e5efe9;
--warning-700: #7c5306;
--warning-100: #f7efdd;
--danger-700: #8f2b21;
--danger-100: #f6e6e3;
--info-700: #2a4666;
--info-100: #e6ebf3;
```

The accent is a dye colour — the madder of naturally dyed thread. It belongs to the craft story, it
is not the blue or purple every other storefront uses, and at `--thread-700` it carries text on
every ground the system defines at AA.

### Surfaces

Five named grounds and no sixth. A surface nobody can name is a surface nobody uses consistently.

| Role         | Value         | What sits on it                                          |
| ------------ | ------------- | -------------------------------------------------------- |
| `surface`    | `--paper-0`   | Cards, panels, table bodies, inputs, sheets              |
| `bg`         | `--paper-50`  | The page                                                  |
| `bg-subtle`  | `--paper-100` | A band lifted off the page — footer, alternating section |
| `bg-sunken`  | `--paper-200` | A well *below* the page — the admin shell                |
| `bg-inverse` | `--ink-950`   | A full-bleed near-black band; the editorial device       |

`bg-sunken` is new in Phase 14.5, and it existed before it was declared: eight components already
wrote `bg-bg-sunken`, which Tailwind compiled to nothing because no token backed it. The admin shell
and every "current" navigation item were silently transparent.

**`bg-inverse` is used at most once per page.** On the storefront it is the closing call to action,
which is what makes the bottom of a long scroll read as an ending rather than as the point where the
content ran out. In the admin it is the sidebar. Two black bands on one page is a stripe pattern.

### Semantic roles

Components use only these. A component that references a raw scale value is a defect.

```css
--color-bg: var(--paper-50);
--color-bg-subtle: var(--paper-100);
--color-bg-sunken: var(--paper-200);
--color-bg-inverse: var(--ink-950);
--color-surface: var(--paper-0);
--color-surface-sunken: var(--paper-100);
--color-surface-inverse: var(--ink-900);

--color-fg: var(--ink-950);
--color-fg-muted: var(--ink-600);
--color-fg-subtle: var(--ink-500);
--color-fg-on-dark: var(--paper-50);
--color-fg-on-dark-muted: var(--ink-300);
--color-fg-on-accent: var(--paper-0);

--color-hairline: rgb(16 15 14 / 0.07); /* between table rows */
--color-border: rgb(16 15 14 / 0.13); /* card and input edges */
--color-border-strong: rgb(16 15 14 / 0.3); /* secondary button, focus edge */
--color-border-on-dark: rgb(250 249 246 / 0.14);

--color-accent: var(--thread-700);
--color-accent-hover: var(--thread-800);
--color-accent-subtle: var(--thread-100);
--color-focus: var(--thread-700);
--color-overlay: rgb(16 15 14 / 0.55);
```

**Three border weights, not two.** `hairline` is what a dense table uses: at 0.07 it separates rows
without drawing a grid over the data, which is the difference between a data table and a
spreadsheet.

**Never express a muted colour as opacity.** `text-fg-on-dark` at 60% looked identical to
`text-fg-on-dark-muted` and measured 3.1:1 against the sidebar; axe caught it in Phase 14.5. A muted
token is a colour somebody chose and can check, an opacity is a colour nobody knows the value of.

### Usage rules

- **Primary button**: `--color-fg` background, `--color-fg-on-dark` text.
- **Accent**: section eyebrows, the active-navigation rule, links in prose, selected states, the
  price emphasis in the builder, the custom-order call to action. Never a large fill except that
  one button.
- The accent appears **exactly once** in a navigation: on the rule marking where you are.
- **Never** communicate meaning with colour alone. Status uses a label plus a shape.
- **Never** introduce a colour outside `tokens.css`, including for a one-off marketing section.
- Photography sits on `--color-surface-sunken` while loading, so a slow image is a neutral block
  rather than a grey hole.

## 5. Spacing

4 px base unit. Only these steps exist.

```
0 · 1(4) · 2(8) · 3(12) · 4(16) · 5(20) · 6(24) · 8(32) · 10(40) · 12(48)
16(64) · 20(80) · 24(96) · 32(128) · 40(160)
```

### Rhythm

| Context                                          | Spacing                    |
| ------------------------------------------------ | -------------------------- |
| Inside a control (button, input, chip)           | 2–3                        |
| Between related elements (label to input)        | 2                          |
| Between form fields                              | 5                          |
| Between a card's content blocks                  | 4                          |
| Between cards in a grid                          | 4 (mobile) / 6 (desktop)   |
| Between subsections                              | 12                         |
| Between page sections                            | 20 (mobile) / 32 (desktop) |
| Between major editorial sections on the homepage | 24 (mobile) / 40 (desktop) |

Generous section spacing is the primary premium signal. When a layout looks wrong, it is almost
always under-spaced vertically, not over-spaced.

---

## 6. Layout and Grid

```
Container         max-width 1440px, gutters 16 / 24 / 40 (mobile / tablet / desktop)
Content column    max-width 1200px
Prose column      max-width 68ch
Narrow column     max-width 560px  (auth, checkout sections)
```

12-column grid on desktop, 6 on tablet, 4 on mobile.

| Surface        | Desktop                                | Tablet           | Mobile                    |
| -------------- | -------------------------------------- | ---------------- | ------------------------- |
| Product grid   | 4 up                                   | 3 up             | 2 up                      |
| Category cards | 3 up                                   | 2 up             | 1.2 up, horizontal snap   |
| Gallery        | Masonry, 3 columns                     | 2 columns        | 1 column                  |
| Product detail | 7 / 5 split (gallery / info)           | stacked          | stacked                   |
| Builder        | 6 / 6 (choices / preview and summary)  | stacked          | stacked                   |
| Checkout       | 7 / 5 (form / summary, summary sticky) | stacked          | stacked, summary as sheet |
| Account        | 240 px sidebar + fluid                 | top tabs + fluid | top tabs                  |
| Admin          | 240 px sidebar + fluid                 | collapsed rail   | drawer                    |

**Breakpoints**: `sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`.

**Full-bleed sections** (hero, gallery bands, the custom CTA) break the container deliberately.
Alternating contained and full-bleed sections is what stops the homepage reading as a template.

---

## 7. Radius, Borders, Elevation

### Radius — deliberately tight

```
--radius-none: 0
--radius-sm:   1px    inputs, chips, badges, small controls
--radius-md:   3px    buttons, cards, dialogs, tables
--radius-lg:   6px    sheets, large panels, images
--radius-full: 9999px pills and avatars only
```

Large radii are the fastest way to look like a consumer app. **Flattened again in Phase 14.5** —
4 px still read as soft at button and card scale beside the new type. Product imagery uses
`--radius-lg`; the interface stays at 1–3 px.

### Borders

`1px solid var(--color-border)` is the default separator. Hairline borders, not shadows, define
surfaces. A card is a bordered white rectangle on warm paper — not a floating shadow box.

### Elevation

Four levels, and only for things that genuinely float.

```
--shadow-none:  none                              /* cards, most surfaces */
--shadow-sm:    0 1px 2px rgb(18 16 14 / .05)     /* sticky bars */
--shadow-md:    0 4px 12px rgb(18 16 14 / .08)    /* dropdowns, popovers */
--shadow-lg:    0 12px 32px rgb(18 16 14 / .12)   /* dialogs, sheets */
--shadow-focus: 0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-focus)
```

Product cards and content cards have **no shadow**. Hover raises the image, not the card.

---

## 8. Components

### Buttons

| Variant     | Fill             | Text                | Border                      | Use                                                  |
| ----------- | ---------------- | ------------------- | --------------------------- | ---------------------------------------------------- |
| `primary`   | `--color-fg`     | `--color-fg-onDark` | none                        | The one main action per view                         |
| `secondary` | transparent      | `--color-fg`        | 1px `--color-border-strong` | Alternative action                                   |
| `accent`    | `--color-accent` | white               | none                        | Custom-order CTAs only                               |
| `ghost`     | transparent      | `--color-fg-muted`  | none                        | Tertiary, icon buttons, table row actions            |
| `link`      | transparent      | `--color-accent`    | none, underline on hover    | Inline                                               |
| `danger`    | transparent      | `--danger-700`      | 1px `--danger-700`          | Destructive; solid only inside a confirmation dialog |

| Size | Height | Padding X | Type          |
| ---- | ------ | --------- | ------------- |
| `sm` | 32px   | 12px      | `body-sm` 500 |
| `md` | 40px   | 16px      | `body-sm` 500 |
| `lg` | 48px   | 24px      | `body` 500    |
| `xl` | 56px   | 32px      | `body-lg` 500 |

- Radius `--radius-md`. Weight 500, never 700 — bold buttons read as shouting.
- Hover: primary lightens to `--ink-800`; secondary fills `--ink-50`; 120 ms.
- Active: `translateY(1px)`, no scale.
- Focus-visible: `--shadow-focus`, always visible, never removed.
- Loading: spinner replaces any leading icon, label persists ("Adding..."), width is preserved so
  the layout does not shift, control is `aria-busy` and disabled.
- Disabled: 40% opacity, `cursor: not-allowed`, and — importantly — a disabled primary action is
  accompanied by a reason in text. A dead button with no explanation is a support ticket.
- Mobile primary actions are `lg` and full-width inside the bottom action bar.

### Inputs

- Height 44 px (`md`), 48 px on mobile. Radius `--radius-sm`.
- `--color-surface` fill, `1px --color-border`, `body` text at `--color-fg`.
- Label above, `heading-sm` weight 500, always present. Placeholders are examples, never labels.
- Focus: border `--color-fg`, plus `--shadow-focus`.
- Error: border `--danger-700`, message below in `body-sm`, linked by `aria-describedby`.
- Helper text below in `body-sm` at `--color-fg-subtle`.
- Required fields are marked; optional fields are marked when most of the form is required.
- Character counters appear on fields with a limit, from 80% of the limit onward.

Specialised inputs:

- **Quantity stepper** — 40 px controls with a centred numeric field; long-press repeats.
- **Colour swatch** — 36 px (44 px mobile) circle with a 2 px ring when selected, a checkmark for
  dark swatches, and an always-available accessible name. Never colour alone.
- **Size chip** — 44 x 40 px minimum, bordered, filled ink when selected, struck through and 40%
  opacity when unavailable, with `aria-disabled` and an explanation.
- **Placement selector** — a radio group of diagram cards, 2 up mobile / 3 up desktop, with the
  zone highlighted in accent on the selected card.
- **File drop zone** — dashed `--color-border-strong`, minimum 160 px tall, accent border while
  dragging, and explicit "Take a photo" / "Choose file" buttons on mobile.

### Cards

Base: `--color-surface`, `1px --color-border`, `--radius-md`, no shadow, padding 5–6.

**Product card** — the most-used component in the system:

```
┌─────────────────────┐
│                     │  4:5 image, --radius-lg, object-cover
│      product        │  second image cross-fades on hover (250 ms)
│       image         │  "New" / "Best seller" badge, top-left, only when true
│                     │  quick-add on hover, desktop only, bottom-right
├─────────────────────┤
│ Category            │  overline, --color-fg-subtle
│ Product Name        │  heading-md, --color-fg, 2-line clamp
│ 4,800 DA  6,000 DA  │  body 500 · compare-at struck, --color-fg-subtle
│ ● ● ● +2            │  colour dots, max 4 then a count
└─────────────────────┘
```

No shadow, no border on the image, no rating stars on the card (they clutter a fashion grid;
ratings live on the product page). The image is the product; the frame disappears.

**Gallery card** — image only, with the caption revealed on hover or below on mobile.

**Order / request card** — status badge top-right, reference in mono, two or three metadata rows,
one action.

### Tables (admin)

- Row height 52 px, header 44 px, `body-sm`.
- Header: `overline` styling, `--color-bg-subtle` background, sticky on scroll.
- Zebra striping is **not** used; a 1 px bottom border per row is enough and reads cleaner.
- Numeric and money columns are right-aligned and tabular; identifiers are mono.
- Row hover: `--color-bg-subtle`. The whole row is a link where there is a canonical detail view.
- Selection: a leading checkbox column with a bulk action bar that appears above the table.
- Sorting: clickable headers with an explicit direction indicator; the sorted column's header
  takes `--color-fg`.
- On mobile, tables become stacked cards. A horizontally scrolling table on a phone is a failure
  state, not a responsive design.
- Every table has a designed empty state and a skeleton with the correct number of columns.

### Dialogs and sheets

- Desktop: centred dialog, max-width 480 px (confirm) or 720 px (form), `--radius-md`,
  `--shadow-lg`, on `--color-overlay`.
- Mobile: bottom sheet, `--radius-lg` on the top corners only, drag handle, swipe to dismiss,
  max height 90 vh with an internal scroll area.
- Focus is trapped, Escape closes, the trigger regains focus on close, background scroll is locked.
- Destructive confirmations name the object ("Cancel order #1042?") and state the consequence.
  The destructive action is on the right and is not the default focus.

### Toasts

- Bottom-right on desktop, top on mobile (below the header, clear of the notch).
- Max 3 stacked; older ones collapse.
- Variants: neutral, success, warning, danger. 4 s auto-dismiss, 8 s when an action is offered,
  never auto-dismissing for a danger toast that requires a decision.
- Announced through a polite live region; assertive only for errors.
- A toast never carries information available nowhere else.
- `ToastProvider` is mounted in the **workshop's root layout** (Phase 14.9) and nowhere else
  yet. `useToast` throws rather than no-oping when it is missing, so a storefront screen that
  wants one has to mount the provider first.

### Badges and status

Small, `--radius-sm`, `caption` weight 500, uppercase, 6 px horizontal padding.

| Badge                 | Style                                   |
| --------------------- | --------------------------------------- |
| `New` / `Best seller` | Ink fill, paper text                    |
| `Sale`                | Accent outline, accent text             |
| `Sold out`            | `--ink-200` fill, `--ink-600` text      |
| `Customisable`        | Accent subtle fill, `--thread-800` text |

**Status indicators** pair a 6 px dot with a label. Colour is never the only signal, and the label
is always present.

| Status group      | Dot             | Label examples                              |
| ----------------- | --------------- | ------------------------------------------- |
| Neutral / waiting | `--ink-400`     | Pending · Draft · Awaiting confirmation     |
| In progress       | `--info-700`    | In review · Design review · In production   |
| Needs attention   | `--warning-700` | Needs info · Quote expiring · Low stock     |
| Positive          | `--success-700` | Confirmed · Accepted · Delivered · Approved |
| Negative          | `--danger-700`  | Cancelled · Rejected · Expired · Failed     |

**Order timeline**: a vertical rail with completed steps filled ink, the current step ringed in
accent, and future steps outlined in `--color-border`. Each entry carries a timestamp in mono.

### Forms

- One column. Two columns only for genuinely paired fields (first/last name, city/postal code)
  and never below `md`.
- Sections have a `heading-md` title and, where useful, one line of description.
- The submit action is bottom-right on desktop, full-width and bottom-anchored on mobile.
- Validation on blur for a touched field, on submit for the whole form. Never on every keystroke.
- A failed submit moves focus to the first invalid field and renders an error summary at the top
  with anchor links.
- Long forms (product editor, checkout) show progress through completed-section indicators.
- Autosave, where present, states its state in text ("Saved 12:04"), never only an icon.

---

## 9. Product Presentation

The catalogue is the brand's showroom; these rules are not optional.

- **Aspect ratios**: product cards 4:5, product detail gallery 4:5, gallery masonry natural,
  category cards 3:2, hero 16:9 desktop / 4:5 mobile. Consistent ratios are what make a grid
  look designed.
- Every product needs at least one **macro detail image** showing stitch texture. It is the proof
  of quality and the reason someone pays a premium.
- Images are AVIF with WebP fallback, `sizes` set correctly per breakpoint, blur placeholder from
  the stored `blurDataUrl`, and explicit width and height to prevent layout shift.
- The detail gallery: a large primary image with thumbnails below on desktop, a snap carousel with
  dot indicators on mobile, click to zoom into a lightbox with pinch support.
- Photography sits on `--color-surface-sunken` while loading.

---

## 10. Motion

### Principles

1. Motion explains a relationship — where something came from, what changed. It is never
   decorative.
2. Fast. Nothing in the interface exceeds 300 ms; most is 120–200 ms.
3. One moving thing at a time in a viewport.
4. Nothing that delays interaction. An element is clickable while it animates in.
5. `prefers-reduced-motion: reduce` removes all transform and opacity transitions, keeps instant
   state changes, and disables scroll reveals entirely.

### Tokens

```css
--ease-out: cubic-bezier(0.22, 0.8, 0.28, 1); /* entrances, the default */
--ease-in-out: cubic-bezier(0.6, 0, 0.3, 1); /* movement between positions */
--ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1); /* cart badge only */

--duration-instant: 80ms /* hover, focus */ --duration-fast: 140ms
  /* buttons, chips, swatches */ --duration-base: 200ms
  /* dropdowns, toasts, tab changes */ --duration-slow: 280ms
  /* dialogs, sheets, step transitions */ --duration-reveal: 420ms
  /* image and scroll reveals */;
```

### Catalogue

| Element             | Motion                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Button hover        | Background 140 ms                                                                                       |
| Product card hover  | Image scales 1.0 to 1.03 and the second image cross-fades, 250 ms; the card does not move               |
| Image load          | Fade from the blur placeholder, 420 ms                                                                  |
| Scroll reveal       | 16 px rise plus fade, 420 ms, once, only on marketing sections, never in the app                        |
| Builder step change | Outgoing slides 12 px and fades out (140 ms), incoming slides in (200 ms); direction follows navigation |
| Cart badge          | Spring scale 1.0 to 1.15 to 1.0, 280 ms, on add                                                         |
| Cart slide-over     | Slide from the right (desktop) or up (mobile), 280 ms                                                   |
| Dialog              | Fade plus 2% scale, 200 ms                                                                              |
| Toast               | Slide 8 px plus fade, 200 ms                                                                            |
| Skeleton            | A slow shimmer, 1.4 s, disabled under reduced motion                                                    |
| Accordion           | Height plus opacity, 200 ms                                                                             |

**Not used**: parallax, scroll-jacking, cursor followers, animated counters, typewriter text,
page-load animations, autoplaying carousels.

---

## 11. Iconography

- One set: **Lucide**, 1.5 px stroke, 20 px default (16 px inline, 24 px touch targets).
- Icons support labels; they replace a label only for universally understood actions (close,
  search, cart), and then always with an `aria-label`.
- No filled icons, no duotone, no mixing sets.
- Placement diagrams and process illustrations are custom SVG assets, not icons, and live in the
  public bucket so the admin can update them.

---

## 12. Admin Visual Language

Same tokens, different density. The admin is the same brand at working speed — calm, fast, precise.

- Type scale drops one step; base body is 14 px.
- Row and control heights compress: buttons 32–36 px, inputs 36–40 px.
- The display serif appears only in page titles and in figures; everything else is Text and
  Technical. Identifiers — order numbers, quote numbers, SKUs — are always Technical.
- Layout is denser: spacing steps 3–4 where the storefront uses 5–6.
- Dark mode is supported by the token layer, but the workshop still renders light (Phase 12).
- Data-first: tables, filters and keyboard access matter more than imagery.
- Destructive actions are visually distinct and always confirmed.
- Every list has a search field, a filter set, a designed empty state and a skeleton.

### The shell

A persistent **sidebar** from `lg`, on `--color-bg-inverse`, 240 px, with grouped navigation
(Atelier, Ventes, Catalogue, Clients), the wordmark at the top and the signed-in account and the
way out at the bottom. Below `lg` it becomes a top bar and a real drawer — focus trapped, escape
closes, the page behind it inert.

The working area is full width to a 1400 px cap rather than a centred 1200 px column. An eight-column
table needs somewhere to be, and a document layout is the wrong shape for a tool somebody uses for
hours.

**Only routes that exist appear in the navigation.** An item leading to a 404 makes the tool look
broken rather than unfinished.

### Tables are the default, not cards

A stack of bordered cards costs roughly six times the vertical space per record and gives the eye no
column to run down. Every admin list is a real `<table>`:

- `<thead>` on `--color-bg-sunken`, `--text-overline`, uppercase.
- Rows separated by `--color-hairline`, never boxed.
- The primary cell carries the identifier as a link that stretches over the whole row
  (`after:absolute inset-0`), so the row is one click target and exactly one tab stop. Anything else
  interactive in the row sits above it with `relative z-10`.
- A second fact — the customer, the date, the SKU — sits under the identifier as `caption/subtle`.
  Two facts in one column is what keeps a table at seven columns instead of eleven.
- Numeric columns are right-aligned and `tabular-nums`.

**Below `md` the same markup becomes stacked blocks.** The `<thead>` goes `sr-only` rather than
`display: none`, so the table keeps its structure for a screen reader, and each cell prints its own
column heading from `data-label`. Section 13 forbids the alternative: a 900 px table in a horizontal
scroller on a 375 px screen, where the columns that matter are the ones off the right edge.

### Figures

`StatTile` is a flat cell on a hairline grid: an overline label, a `display-md` tabular figure, one
line of hint. No card, no shadow, no icon tile, no coloured fill — the number is the only thing that
should attract the eye, and `tone` tints the figure alone. A zero renders `subtle`, because on a
queue tile a zero is good news.

**Every tile is the length of a queue somebody can work, and every tile links to it.** A figure that
leads nowhere is a decoration; `UX.md` section 9 forbids it and `PRODUCT.md` puts analytics in V2.

### Filters and search

Filters are **links**, so a filtered queue is a URL somebody can bookmark, share and return to.
Search is a `GET` form to the same URL, for the same reason. Neither is a client-side filter over a
payload that would have had to ship every record to the browser.

---

## 13. Responsive Rules

- **Mobile-first.** Base styles target 375 px; breakpoints add, never subtract.
- Every interactive target is at least 44 x 44 px with 8 px of separation.
- No horizontal page scroll at any width. Wide content (admin tables, code, long option rows)
  scrolls inside its own container with a visible edge affordance.
- A single-column-per-screen sequence on mobile — this is why the builder is a step flow rather
  than a long form.
- Sticky elements: the header on scroll-up only; the checkout summary on desktop; the builder's
  estimate and action bar on mobile. Nothing else is sticky.
- Safe-area insets are respected on every bottom-anchored element.
- Type never drops below 15 px for body copy on mobile; form inputs are 16 px so iOS does not zoom.
- Hover-only affordances (quick-add, caption reveal) always have a tap-accessible equivalent.
- Layout is tested at 320, 375, 414, 768, 1024, 1280 and 1440 px.

---

## 14. Accessibility

Target **WCAG 2.1 AA**. These are requirements, not aspirations.

**Colour and contrast**

- Body text at least 4.5:1; large text and UI boundaries at least 3:1.
- Measured in Phase 4 against the paper ground `#f6f2ec`, white, and the sunken surface:

  | Role                        | Value     | On paper | On white | On sunken |
  | --------------------------- | --------- | -------- | -------- | --------- |
  | `--color-fg` (ink-950)      | `#12100e` | 17.0     | 19.0     | 15.8      |
  | `--color-fg-muted` (ink-600)| `#5a534b` | 6.8      | 7.6      | 6.3       |
  | `--color-fg-subtle` (ink-500)| `#6f675d` | 5.0      | 5.6      | 4.6       |
  | `--color-accent` (thread-700)| `#9a4e26` | 5.4      | 6.0      | 5.0       |

  `--color-fg-subtle` was `#7a7268` and measured **4.25:1** — below AA, and it is the token behind
  captions, overlines and helper text, the smallest type in the system. It was darkened rather
  than avoided. **Every one of these must be re-measured on a rebrand**; the axe assertion on the
  showcase catches a regression, but only for combinations the showcase renders.
- Colour is never the sole carrier of meaning — status, validation, availability and selection all
  pair colour with text or shape.

**Keyboard**

- Every interactive element is reachable and operable by keyboard, in a logical order.
- Focus-visible styling is always present; `outline: none` without a replacement is prohibited.
- A skip link precedes the header. Dialogs trap focus and restore it on close.
- The custom builder, checkout and admin tables are fully keyboard-operable.

**Semantics**

- Semantic HTML first; ARIA only where no element expresses the pattern.
- One `h1` per page, no skipped heading levels.
- Landmarks: `header`, `nav`, `main`, `aside`, `footer` on every page.
- Form controls have real `label` elements; errors are associated by `aria-describedby` and
  marked with `aria-invalid`.
- Buttons are `button`; links are `a`. A `div` with a click handler is a defect.

**Dynamic content**

- Status messages, cart updates and price changes use a polite live region; errors use assertive.
- Loading states are announced, not only shown.
- Route changes move focus to the main heading.

**Media**

- Every image has meaningful alt text; decorative images have `alt=""`. `alt` is NOT NULL in the
  database for exactly this reason.
- Product images describe the product, not the file name.

**Motion**

- `prefers-reduced-motion` is respected globally, at the token level, so no component can opt out.

**Testing**

- Automated: `eslint-plugin-jsx-a11y` in CI, axe assertions in Playwright on key routes.
- Manual: keyboard-only pass and a screen-reader pass on the builder, checkout and account before
  launch. Automated checks catch perhaps a third of real issues.

---

## 15. The Implementation

Built in Phase 4, revised in Phase 14.5. This section describes what exists in the repository, as
distinct from the intent above. Where the two ever disagree, the code is what ships and this section
is the bug.

### Where things live

| Path                       | Holds                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| `styles/tokens.css`        | Every raw value: colour, type, spacing, radius, shadow, motion, animation |
| `styles/globals.css`       | Base layer, the skip link, reduced motion, and the duration utilities     |
| `components/ui/`           | Primitives: button, link, typography, field, input, feedback, card, overlay, navigation, toast, **table, page-header, stat** |
| `components/layout/`       | Container, Section, Stack, Inline, Grid, Header                          |
| `components/commerce/`     | Price, QuantitySelector, ProductCard, status indicators                  |
| `components/media/`        | ProductImage, MediaPlaceholder, MediaSkeleton                            |
| `components/upload/`       | UploadDropzone, FileCard                                                 |
| `app/dev/design-system/`   | The showcase. Development only                                           |

### Component inventory

Everything below exists and is exercised by a test.

- **Foundation** — `Button` (6 variants + `dangerSolid`, 4 sizes, loading, `asChild`),
  `IconButton` (label required), `Link` (3 variants, `external`), `Text`, `Heading`, `Overline`,
  `Label`, `Divider`, `Container`, `Section`, `Stack`, `Inline`, `Grid`.
- **Forms** — `FormField` (render-prop wiring), `Input`, `Textarea`, `SelectField`,
  `NativeSelect`, `CheckboxField`, `RadioField`, `SwitchField`, `FieldError`, `HelperText`.
- **Feedback** — `Alert` (5 tones), `Badge` (5 variants **plus 5 status tones**),
  `ToastProvider` + `useToast`,
  `ProgressBar`, `Skeleton`, `SkeletonRegion`, `EmptyState`.
- **Surfaces** — `Card` + `CardHeader`/`CardBody`/`CardFooter`, `Modal`, `Sheet`, `Menu`,
  `PopoverPanel`, `InfoTooltip` + `TooltipProvider`.
- **Navigation** — `Header` + `Wordmark`, `Breadcrumbs`, `TabSet`, `Pagination`, `PageHeader`,
  `FilterBar` + `FilterLink`.
- **Data** *(Phase 14.5)* — `Table`, `TableHead`, `TableBody`, `TableRow`, `TableHeaderCell`,
  `TableCell`, `TableRowLink`, `TableRowAction`, `TableCellMeta`, `TableToolbar`, `StatGrid`,
  `StatTile`.
- **Commerce** — `Price` + `formatMoney`, `QuantitySelector`, `ProductCard` +
  `ProductCardSkeleton`, `StatusIndicator` and the three typed lifecycle badges.
- **Media and upload** — `ProductImage`, `MediaPlaceholder`, `MediaSkeleton`, `UploadDropzone`,
  `FileCard`, `isPreviewable`.

Radix supplies the behaviour that is genuinely hard — focus trapping, focus restoration, Escape,
scroll locking, typeahead, roving tabindex — for Select, Checkbox, Radio, Switch, Dialog, Sheet,
DropdownMenu, Popover, Tooltip, Tabs, Progress, Separator and Toast. Everything visual is ours.

### Two implementation notes that are load-bearing

**Custom scales must be declared to `tailwind-merge`.** `components/ui/cn.ts` extends it with the
font-size token names and `shadow-focus`. Without that, tailwind-merge files an unknown `text-*`
class as a *colour*, and since `Text` renders `cn(size, tone)` the tone silently deletes the size —
the whole type scale collapsed to inherited body text wherever a tone was set. It is invisible in
review and was caught only because an axe contrast failure reported the wrong font size. **Adding a
font-size token to `tokens.css` means adding it to `cn.ts` in the same change.**

**Duration utilities are defined by hand.** Tailwind v4 has no `--duration-*` theme namespace, so
`duration-fast` would compile to nothing and every transition would silently fall back to the
framework default. `globals.css` declares `duration-instant|fast|base|slow|reveal` with `@utility`.

**A `SelectField` inside a `<form action={...}>` needs a `name`.** Radix renders a hidden native
select only when `Select.Root` is given one; without it the trigger is a button and the field posts
nothing — a silent failure that looks like a working form. `NativeSelect` exists alongside it for
the one case Radix cannot serve: a select whose *empty* option is meaningful, since Radix reserves
the empty value for "nothing is selected".

**A component declared inside another component is a new type on every render.** The React lint rule
catches it; the symptom it prevents is a subtree that throws away its state whenever the parent
re-renders. Queue tables are declared at module scope and take their data as props.
The `--ease-*` and `--animate-*` namespaces are real, so easings and the animation catalogue come
straight from the tokens.

### Motion, as built

The section 10 catalogue is expressed as `--animate-*` tokens with their keyframes in
`tokens.css`: `fade-in`/`fade-out`, `dialog-in`/`dialog-out`, `slide-in|out-right|left|bottom`,
`toast-in`/`toast-out`, `shimmer`. No animation plugin or library is installed. Reduced motion is
handled once, globally, in `globals.css` — components carry `motion-reduce:` classes as a second
layer, but cannot opt out of the global rule.

### The mark

The logo is `public/assets/brand/logo.png` — a 150 × 150 raster on a solid white ground, supplied
by the owner. It is the favicon (`app/icon.png`) and it appears in the footer **on a light chip**,
because a white square dropped bare onto the dark palette reads as a broken image, and inverting
somebody's logo is not the design system's decision to make. The header and the sidebar use the
typographic wordmark, which is legible at 40px in a way a 150px raster is not.

A transparent SVG would let the mark sit directly on the page in both themes, and is the one asset
worth asking for before launch.

### Themes

> **Rewritten in Phase 14.7.** Light and dark both ship, and the storefront honours the visitor's
> system preference out of the box. ADR-031 records why the palettes are declared the way they are.

**Every token declares both values on one line**, with the CSS `light-dark()` function, inside a
single `:root` block:

```css
:root {
  color-scheme: light dark;

  --stitch-bg: light-dark(var(--color-paper-50), var(--color-ink-950));
  --stitch-surface: light-dark(var(--color-paper-0), var(--color-ink-900));
  --stitch-fg: light-dark(var(--color-ink-900), var(--color-paper-50));
  /* …thirty-one of these… */
}
```

There is no second block of dark values to keep in step. A token added to the light palette and
forgotten in the dark one is not possible, because there is one place to add it.

**The switch is `color-scheme`, not a class.**

```css
:root[data-theme='light'] { color-scheme: light; }
:root[data-theme='dark']  { color-scheme: dark; }
```

A visitor who has never touched the control gets their operating system's preference with no
JavaScript running. `ThemeToggle` (light / dark / system) sets `data-theme` on the root element and
remembers the choice in `localStorage`; an inline script in the document head applies it **before
the first paint**, so there is no flash of the other palette. The toggle reads the current value
back off the document with `useSyncExternalStore` rather than keeping a copy in React state.

**Three rules that the first dark pass broke, in order of how easily they are broken again:**

1. **Never use `opacity` to mute a colour.** `text-fg-on-dark` at `opacity-60` measures 3.1:1 — a
   contrast failure that looks fine to whoever wrote it. Muted-on-dark is its own token,
   `fg-on-dark-muted`.
2. **Never hard-code an inversion.** `bg-fg text-fg-on-dark` is light-on-light in dark mode, because
   `--stitch-fg` is already light there. The pairs that invert have tokens of their own:
   `fg-inverted`, `fg-hover`, `hover`, `track`.
3. **Give `body` an explicit token background.** A transparent body borrows whatever the browser
   paints behind it, which is the wrong ground in exactly one of the two themes.

**The admin is not themed.** `/admin` renders in the light palette deliberately; a dark workshop is
still on Phase 12's outstanding list. The sidebar's near-black is a surface, not a theme.

**It is contrast-tested.** `tests/e2e/i18n.spec.ts` runs axe over the homepage, the shop and the
builder in a dark-preferring browser context, and asserts the system preference alone changes the
painted ground in both directions.

### The showcase

`/dev/design-system`. It renders every primitive in every state from literals — no data layer, no
auth, no business behaviour. `notFound()` in production, so the route does not exist on a deployed
site rather than merely being unlinked, and it is `noindex` where it does render.

It is also the accessibility harness. The Playwright project runs axe over it at desktop and phone
viewports and asserts no WCAG 2.1 A/AA violations, no horizontal overflow, a painted focus ring, a
dialog that traps and restores focus, a toast that reaches the live region, and transitions
collapsed under reduced motion.

