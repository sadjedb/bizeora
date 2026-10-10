# Photography

Every image the storefront shows comes from this folder. Most of it is now
**real work from the workshop**, taken from the business's Instagram page
(@bizeora.co): the six gallery pieces, the homepage hero, the polo, and the
extra photographs (`3.jpg`, `4.jpg`) of the T-shirt and the hoodie. Their
`1.jpg` and `2.jpg` are the studio shots of the blank garment, front and back —
they are the surfaces a customer drops a design onto (ADR-035), so they must
stay straight-on photographs of an unembroidered piece.

What is still a **placeholder** — a flat coloured card with the piece's name
written across it — is the cap, the beanie, the tote bag and the apron, which
the Instagram page has no photograph of.

## How a real photograph replaces one

Drop the photograph over the placeholder, keeping the **file name and the
folder**. Nothing else changes: no code, no database row, no rebuild of the
catalogue.

```
public/assets/
├── products/<product slug>/1.jpg   the card and the gallery's first image
├── products/<product slug>/2.jpg   further images, in order
├── gallery/<gallery slug>.jpg      one image per piece of work
└── site/hero.jpg                   the homepage's full-screen image
```

The slug is the one in the address bar: `/fr/shop/tote-bag-toile-epaisse` is
`products/tote-bag-toile-epaisse/`. A product with three photographs has `1.jpg`,
`2.jpg` and `3.jpg`; the numbering has no gaps.

## What the files should be

|                |                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------ |
| Format         | JPEG (`.jpg`). PNG only where transparency is genuinely needed.                            |
| Product images | 1600 × 2000 (4:5 portrait), the ratio the cards and the product page crop to               |
| Gallery images | 1600 × 1600 (square)                                                                       |
| Hero           | 2400 × 1600 or wider — it is cropped to the viewport, so leave room around the subject     |
| Weight         | under 400 KB each after export; `next/image` re-encodes and resizes, but it cannot un-blur |

Photograph on a plain, light, non-white ground, in daylight, with the
embroidery in focus. The site's palette is warm off-white; a photograph on a
cold grey ground will look out of place beside it.

## Where they are served from

`NEXT_PUBLIC_PUBLIC_ASSET_URL` (`.env.local`) is `/assets`, so the files are
served by the application itself from `public/`. Pointing that variable at a
CDN or an object-storage bucket moves the whole folder there without touching
a line of code — `toPublicAssetUrl` builds every URL from it.

**This folder is public.** Anything dropped here can be fetched by anyone who
guesses the name. Customer artwork is never stored here: it lives in the
private bucket behind `lib/storage`, reachable only through short-lived signed
URLs after an authorisation check (`SECURITY.md` section 6).
