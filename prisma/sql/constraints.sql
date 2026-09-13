-- ===========================================================================
-- STITCH — constraints and partial indexes
--
-- Prisma cannot express CHECK constraints or partial (WHERE) indexes in
-- schema.prisma. Everything DATABASE.md requires that Prisma cannot generate
-- lives here and is appended verbatim to the initial migration.
--
-- This file is the maintained source; prisma/migrations/*/migration.sql
-- carries a copy so migrations stay self-contained and reproducible.
--
-- Every statement names the DATABASE.md section it implements.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Extensions. `citext` backs users.email and coupons.code (section 4, 12).
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS citext;


-- ---------------------------------------------------------------------------
-- Soft-delete-aware unique indexes (section 1: "`deletedAt IS NULL` is part of
-- the relevant unique indexes").
-- ---------------------------------------------------------------------------

-- users.email — section 4
DROP INDEX IF EXISTS "users_email_key";
CREATE UNIQUE INDEX "users_email_active_key"
  ON "users" ("email") WHERE "deleted_at" IS NULL;

-- categories.slug — section 5
CREATE UNIQUE INDEX "categories_slug_active_key"
  ON "categories" ("slug") WHERE "deleted_at" IS NULL;

-- products.slug — section 5
CREATE UNIQUE INDEX "products_slug_active_key"
  ON "products" ("slug") WHERE "deleted_at" IS NULL;

-- collections.slug — section 5 (V1.5)
CREATE UNIQUE INDEX "collections_slug_active_key"
  ON "collections" ("slug") WHERE "deleted_at" IS NULL;

-- reviews: one review per customer per product — section 11, constraint 11
CREATE UNIQUE INDEX "reviews_user_product_active_key"
  ON "reviews" ("user_id", "product_id") WHERE "deleted_at" IS NULL;


-- ---------------------------------------------------------------------------
-- Other partial unique indexes (section 18)
-- ---------------------------------------------------------------------------

-- One default address per user — constraint 9
CREATE UNIQUE INDEX "addresses_one_default_per_user"
  ON "addresses" ("user_id") WHERE "is_default";

-- One primary image per product — section 5
CREATE UNIQUE INDEX "product_images_one_primary_per_product"
  ON "product_images" ("product_id") WHERE "is_primary";

-- One active standard cart per user — constraint 7
CREATE UNIQUE INDEX "carts_one_active_standard_per_user"
  ON "carts" ("user_id")
  WHERE "kind" = 'STANDARD' AND "status" = 'ACTIVE' AND "user_id" IS NOT NULL;

-- Adding the same variant twice increments rather than duplicates — section 7
CREATE UNIQUE INDEX "cart_items_one_stock_line_per_variant"
  ON "cart_items" ("cart_id", "variant_id") WHERE "kind" = 'STOCK';

-- One active tier per lower bound — section 12
CREATE UNIQUE INDEX "discount_tiers_active_min_quantity_key"
  ON "discount_tiers" ("min_quantity") WHERE "is_active";


-- ---------------------------------------------------------------------------
-- Partial and expression indexes that carry query load (section 17)
-- ---------------------------------------------------------------------------

-- Staff lookup — section 4
CREATE INDEX "users_staff_idx" ON "users" ("role") WHERE "role" <> 'CUSTOMER';

-- Featured and new-arrival merchandising — section 5
CREATE INDEX "products_featured_active_idx"
  ON "products" ("published_at" DESC)
  WHERE "is_featured" AND "status" = 'ACTIVE';

CREATE INDEX "products_new_arrival_active_idx"
  ON "products" ("published_at" DESC)
  WHERE "is_new_arrival" AND "status" = 'ACTIVE';

-- Full-text search over the catalogue — section 5, section 17
CREATE INDEX "products_search_idx" ON "products"
  USING GIN (
    to_tsvector(
      'simple',
      coalesce("name", '') || ' ' || coalesce("subtitle", '') || ' ' || coalesce("description", '')
    )
  );

-- The admin's primary queue, oldest first — section 9
CREATE INDEX "custom_requests_queue_idx"
  ON "custom_requests" ("submitted_at" ASC)
  WHERE "status" IN ('SUBMITTED', 'IN_REVIEW', 'NEEDS_INFO');

-- Quote send-expiry job — section 10
CREATE INDEX "quotes_send_expiry_idx"
  ON "quotes" ("valid_until")
  WHERE "status" IN ('SENT', 'VIEWED');

-- Quote acceptance-expiry job — section 10
CREATE INDEX "quotes_acceptance_expiry_idx"
  ON "quotes" ("acceptance_valid_until")
  WHERE "status" = 'ACCEPTED';

-- Quote-bound cart invalidation job — section 7
CREATE INDEX "carts_quote_expiry_idx"
  ON "carts" ("quote_valid_until")
  WHERE "kind" = 'QUOTE_BOUND' AND "status" = 'ACTIVE';

-- Review moderation queue — section 11
CREATE INDEX "reviews_pending_idx" ON "reviews" ("created_at")
  WHERE "status" = 'PENDING';

-- Orphaned upload cleanup — section 6
CREATE INDEX "design_files_pending_idx" ON "design_files" ("created_at")
  WHERE "status" = 'PENDING';

-- Outbox dispatch — section 14
CREATE INDEX "notifications_dispatch_idx"
  ON "notifications" ("scheduled_for")
  WHERE "status" = 'PENDING';


-- ---------------------------------------------------------------------------
-- CHECK constraints (section 18)
-- ---------------------------------------------------------------------------

-- 5. Stock is never negative
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_stock_non_negative"
  CHECK ("stock_quantity" >= 0 AND "reserved_quantity" >= 0);

-- 6. Ratings are 1..5
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

-- 1. Order totals reconcile
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_totals_reconcile"
  CHECK ("grand_total" = "subtotal" - "discount_total" + "shipping_total" + "tax_total");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amount_paid_non_negative" CHECK ("amount_paid" >= 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_deposit_within_total"
  CHECK ("deposit_required" >= 0 AND "deposit_required" <= "grand_total");

-- 2. Order line totals reconcile
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_line_total_reconciles"
  CHECK ("line_total" = "unit_price" * "quantity" - "line_discount");

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);

-- 13. A line is STOCK with a variant, CUSTOM with a configuration, or FEE with
--     a name, a quantity of 1 and no references.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_kind_shape" CHECK (
    ("kind" = 'STOCK'  AND "variant_id" IS NOT NULL AND "fee_kind" IS NULL)
    OR
    ("kind" = 'CUSTOM' AND "customization_config_id" IS NOT NULL AND "fee_kind" IS NULL)
    OR
    ("kind" = 'FEE'    AND "fee_kind" IS NOT NULL
                       AND "quantity" = 1
                       AND "requires_production" = false
                       AND "product_id" IS NULL
                       AND "variant_id" IS NULL
                       AND "customization_config_id" IS NULL)
  );

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_range"
  CHECK ("quantity" > 0 AND "quantity" <= 999);

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_kind_shape" CHECK (
    ("kind" = 'STOCK'  AND "variant_id" IS NOT NULL)
    OR
    ("kind" = 'CUSTOM' AND "customization_config_id" IS NOT NULL)
    OR
    ("kind" = 'FEE'    AND "name_snapshot" IS NOT NULL
                       AND "quantity" = 1
                       AND "variant_id" IS NULL
                       AND "customization_config_id" IS NULL)
  );

-- A locked price only exists on a quote-derived line — section 7
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_locked_price_requires_quote_item"
  CHECK ("locked_unit_price" IS NULL OR "quote_item_id" IS NOT NULL);

-- Cart shape — section 7
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_owner_exactly_one"
  CHECK (("user_id" IS NULL) <> ("anonymous_token" IS NULL));

ALTER TABLE "carts"
  ADD CONSTRAINT "carts_kind_shape" CHECK (
    ("kind" = 'QUOTE_BOUND' AND "quote_id" IS NOT NULL
                            AND "user_id" IS NOT NULL
                            AND "coupon_id" IS NULL)
    OR
    ("kind" = 'STANDARD'    AND "quote_id" IS NULL)
  );

-- 4. Quote totals reconcile
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_totals_reconcile"
  CHECK ("grand_total" = "subtotal" - "discount_total" + "shipping_total" + "tax_total");

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_valid_until_after_creation"
  CHECK ("valid_until" > "created_at");

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_acceptance_validity_requires_acceptance"
  CHECK ("acceptance_valid_until" IS NULL OR "accepted_at" IS NOT NULL);

ALTER TABLE "quote_items"
  ADD CONSTRAINT "quote_items_line_total_reconciles"
  CHECK ("line_total" = "unit_price" * "quantity");

-- 14. A customisation names either a catalogue product or a free-text type
ALTER TABLE "customization_configs"
  ADD CONSTRAINT "customization_configs_names_a_product"
  CHECK ("product_id" IS NOT NULL OR "freeform_product_type" IS NOT NULL);

-- 16. A frozen customisation carries its display snapshots
ALTER TABLE "customization_configs"
  ADD CONSTRAINT "customization_configs_frozen_has_snapshots"
  CHECK (
    "frozen_at" IS NULL
    OR "placement_id" IS NULL
    OR "placement_label" IS NOT NULL
  );

ALTER TABLE "customization_configs"
  ADD CONSTRAINT "customization_configs_thread_color_count_positive"
  CHECK ("thread_color_count" >= 1);

ALTER TABLE "custom_request_items"
  ADD CONSTRAINT "custom_request_items_quantity_positive" CHECK ("quantity" > 0);

-- 17. Discount tiers — ADR-017
ALTER TABLE "discount_tiers"
  ADD CONSTRAINT "discount_tiers_min_quantity_positive" CHECK ("min_quantity" >= 1);

ALTER TABLE "discount_tiers"
  ADD CONSTRAINT "discount_tiers_max_after_min"
  CHECK ("max_quantity" IS NULL OR "max_quantity" >= "min_quantity");

ALTER TABLE "discount_tiers"
  ADD CONSTRAINT "discount_tiers_basis_points_range"
  CHECK ("discount_basis_points" BETWEEN 0 AND 10000);

-- ADR-018: percentage settings are basis points. Coupon percentages are bounded
-- at the same range; FIXED_AMOUNT values are minor units and are only bounded
-- below.
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_value_range" CHECK (
    ("type" = 'PERCENTAGE' AND "value" BETWEEN 0 AND 10000)
    OR ("type" <> 'PERCENTAGE' AND "value" >= 0)
  );

-- Money is never negative where a negative value has no meaning
ALTER TABLE "products"
  ADD CONSTRAINT "products_base_price_non_negative" CHECK ("base_price" >= 0);

ALTER TABLE "shipping_rates"
  ADD CONSTRAINT "shipping_rates_price_non_negative" CHECK ("price" >= 0);

ALTER TABLE "shipping_rates"
  ADD CONSTRAINT "shipping_rates_estimate_order"
  CHECK ("estimated_max_days" >= "estimated_min_days" AND "estimated_min_days" >= 0);


-- ---------------------------------------------------------------------------
-- NOT enforced here, deliberately:
--
--   * `orders.subtotal = sum(order_items.line_total)`
--     A CHECK sees one row and cannot aggregate over another table, so this is
--     not expressible as a database constraint. It is classified as a
--     service/domain invariant in DATABASE.md section 18.2: the rule and the
--     quote-line to order-line mapping are BUSINESS-RULES.md section 2.6.5, and
--     it is enforced at order placement by the exact-total check in
--     BUSINESS-RULES.md section 5A.6. Deliberately not a trigger — pricing
--     arithmetic stays out of SQL so the rule has exactly one implementation.
--
--   * discount tier non-overlap and full coverage (DATABASE.md section 12)
--     Also a service/domain invariant (section 18.2), validated over the active
--     set on write, with a Postgres exclusion constraint recorded as a future
--     option.
-- ---------------------------------------------------------------------------
