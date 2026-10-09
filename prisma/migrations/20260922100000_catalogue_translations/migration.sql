-- ---------------------------------------------------------------------------
-- The catalogue learns to speak English.
--
-- The interface, the workshop and the homepage's bands have been bilingual
-- since Phase 14.7. The **catalogue** never was: product names, descriptions,
-- category names, gallery captions and the banner strip are single-language
-- rows, so an English visitor reads an English shell wrapped around French
-- content. That is the largest remaining gap between what the site claims to be
-- and what it is.
--
-- ## Why a JSON overlay and not a translations table
--
-- ADR-027 already answered this question once, for the homepage: a row carries
-- its translations inside a JSON column, keyed by locale, and `localiseSection`
-- merges them over the row's own columns with French as the fallback. The same
-- mechanism, the same fallback, the same shape — extended from one table to
-- four rather than joined by a second design nobody has a reason to prefer.
--
-- What that buys:
--
--   * **Partial translation is the normal case.** A product with an English
--     name and no English description reads correctly: the overlay mentions
--     what it has and the rest stays French. A translations table makes the
--     same thing possible but makes "half a row" the awkward case.
--   * **No join on the hot path.** The catalogue's list query already counts
--     twice and selects a relation tree; a fourth join per page for two
--     languages is a cost with no reader behind it.
--   * **One nullable column per table**, which is this file.
--
-- What it costs, written down so the next person does not rediscover it:
--
--   * **`ORDER BY name` sorts by the French name** whatever language the
--     visitor is reading. Sorting a JSON path is possible and not indexed.
--   * **Searching the translated name is a JSON path match**, not an indexed
--     column. Fine over hundreds of rows, wrong over hundreds of thousands.
--   * **A third language is a bigger change here than it would be in a table.**
--
-- The day any of those three bites — a real third language, or a catalogue big
-- enough that translated search needs an index — the migration is mechanical:
-- the overlay's shape is exactly one row per locale.
--
-- ## Shape
--
--     { "en": { "name": "Embroidered classic t-shirt", "description": "…" } }
--
-- Keyed by locale, then by the column it overrides. Nothing validates it here;
-- `domain/translation` owns which fields may be translated and how long each
-- may be, the same way `domain/settings` owns what a setting may hold.
-- ---------------------------------------------------------------------------

ALTER TABLE "products" ADD COLUMN "translations" JSONB;
ALTER TABLE "categories" ADD COLUMN "translations" JSONB;
ALTER TABLE "gallery_items" ADD COLUMN "translations" JSONB;
ALTER TABLE "banners" ADD COLUMN "translations" JSONB;

-- The overlay is an object keyed by locale, never an array and never a scalar.
-- A CHECK rather than a comment because this column is written by a form, and a
-- malformed overlay would fail silently by simply not translating anything.
ALTER TABLE "products"
  ADD CONSTRAINT "products_translations_object"
  CHECK ("translations" IS NULL OR jsonb_typeof("translations") = 'object');

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_translations_object"
  CHECK ("translations" IS NULL OR jsonb_typeof("translations") = 'object');

ALTER TABLE "gallery_items"
  ADD CONSTRAINT "gallery_items_translations_object"
  CHECK ("translations" IS NULL OR jsonb_typeof("translations") = 'object');

ALTER TABLE "banners"
  ADD CONSTRAINT "banners_translations_object"
  CHECK ("translations" IS NULL OR jsonb_typeof("translations") = 'object');
