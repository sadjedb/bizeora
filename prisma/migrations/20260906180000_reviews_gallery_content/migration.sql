-- Phase 13 — reviews, gallery and homepage content.
--
-- No new tables: `reviews`, `gallery_items`, `homepage_sections`, `banners` and
-- `social_links` were all created by the initial migration and have been unused
-- until now. What this adds is the two things the read paths need and the one
-- guarantee that must not depend on a service remembering it.

-- ---------------------------------------------------------------------------
-- The consent rule, as a constraint.
--
-- BUSINESS-RULES.md 13.6: a gallery item derived from a customer's design may
-- be published only with a recorded consent. DATABASE.md section 13 specified
-- this as a service-layer invariant asserted by test; it is now both. The
-- domain refuses it with a sentence a person can act on, and the constraint
-- makes the row impossible.
--
-- Two enforcements rather than one because this is the single place in the
-- application where a private customer file could become public by accident,
-- and the cost of that mistake is not a bug report.
-- ---------------------------------------------------------------------------
ALTER TABLE "gallery_items"
  ADD CONSTRAINT "gallery_items_consent_required"
  CHECK (
    "source_design_file_id" IS NULL
    OR "is_published" = false
    OR "customer_consent_at" IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- The gallery listing's index.
--
-- Partial on the published rows, ordered the way `/gallery` orders: curated
-- position first, then newest. Partial for the same reason the outbox and cart
-- indexes are — the published set stays small while the table grows.
-- ---------------------------------------------------------------------------
CREATE INDEX "gallery_items_published_idx"
  ON "gallery_items" ("position", "created_at" DESC)
  WHERE "is_published" AND "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- The moderation queue's index.
--
-- `reviews_pending_idx` already covers PENDING. The moderation screen also
-- lists approved and rejected reviews, so this covers the filtered queue in
-- whichever state it is asked for.
-- ---------------------------------------------------------------------------
CREATE INDEX "reviews_status_created_at_idx"
  ON "reviews" ("status", "created_at" DESC)
  WHERE "deleted_at" IS NULL;
