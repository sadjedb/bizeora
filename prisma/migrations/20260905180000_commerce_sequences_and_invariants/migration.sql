-- Phase 8 — commerce foundation.
--
-- Two things the application layer cannot express safely on its own:
--
--   1. Sequence-backed human identifiers. `DATABASE.md` section 1 requires
--      `orderNumber`, `quoteNumber` and `requestNumber` to be sequence-backed.
--      Phase 7 derived request numbers from MAX(request_number), which the
--      Phase 7 audit recorded as a concurrency risk: two simultaneous
--      submissions read the same maximum and the second collides. `nextval` is
--      non-transactional, so it never blocks and never repeats — it produces
--      gaps when a transaction rolls back, which is the correct trade for an
--      identifier whose only job is to be unique and readable aloud.
--
--   2. The invariants `DATABASE.md` sections 7 and 8 specify as check
--      constraints. Prisma's schema language cannot express them, so they have
--      never existed in the database. Money invariants in particular must not
--      depend on the application being correct.

-- ---------------------------------------------------------------------------
-- 1. Human identifiers
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS "order_number_seq" AS bigint START WITH 1;
CREATE SEQUENCE IF NOT EXISTS "request_number_seq" AS bigint START WITH 1;

-- The year is a readable prefix, not part of the uniqueness argument: the
-- sequence is global and never restarts, so numbering continues across a year
-- boundary rather than colliding with last year's. See ADR-020.
CREATE OR REPLACE FUNCTION next_order_number() RETURNS text
  LANGUAGE sql VOLATILE
  AS $$
    SELECT 'CMD-' || to_char(now(), 'YYYY') || '-'
        || lpad(nextval('order_number_seq')::text, 4, '0');
  $$;

CREATE OR REPLACE FUNCTION next_request_number() RETURNS text
  LANGUAGE sql VOLATILE
  AS $$
    SELECT 'DEM-' || to_char(now(), 'YYYY') || '-'
        || lpad(nextval('request_number_seq')::text, 4, '0');
  $$;

-- Phase 7 already issued request numbers by hand. Start the sequence past the
-- highest of them so the retrofit cannot collide with a number already printed
-- on a customer's screen. `substring(... from 10)` skips the "DEM-YYYY-" prefix.
SELECT setval(
  'request_number_seq',
  COALESCE(
    (SELECT MAX(NULLIF(regexp_replace(substring("request_number" from 10), '\D', '', 'g'), '')::bigint)
       FROM "custom_requests"),
    0
  ) + 1,
  false
);

-- ---------------------------------------------------------------------------
-- 2. Cart invariants (DATABASE.md section 7)
-- ---------------------------------------------------------------------------

ALTER TABLE "carts"
  ADD CONSTRAINT "carts_owner_check"
    CHECK (("user_id" IS NOT NULL) <> ("anonymous_token" IS NOT NULL)),
  ADD CONSTRAINT "carts_quote_bound_check"
    CHECK (
      "kind" <> 'QUOTE_BOUND'
      OR ("quote_id" IS NOT NULL AND "user_id" IS NOT NULL AND "coupon_id" IS NULL)
    ),
  ADD CONSTRAINT "carts_standard_check"
    CHECK ("kind" <> 'STANDARD' OR "quote_id" IS NULL);

-- One active standard cart per customer; a customer may hold any number of
-- quote-bound carts alongside it (BUSINESS-RULES.md 5A.2).
CREATE UNIQUE INDEX "carts_active_standard_per_user"
  ON "carts" ("user_id")
  WHERE "kind" = 'STANDARD' AND "status" = 'ACTIVE' AND "user_id" IS NOT NULL;

CREATE INDEX "carts_quote_bound_expiry"
  ON "carts" ("quote_valid_until")
  WHERE "kind" = 'QUOTE_BOUND' AND "status" = 'ACTIVE';

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_quantity_check"
    CHECK ("quantity" > 0 AND "quantity" <= 999),
  ADD CONSTRAINT "cart_items_stock_check"
    CHECK ("kind" <> 'STOCK' OR "variant_id" IS NOT NULL),
  ADD CONSTRAINT "cart_items_custom_check"
    CHECK ("kind" <> 'CUSTOM' OR "customization_config_id" IS NOT NULL),
  ADD CONSTRAINT "cart_items_fee_check"
    CHECK (
      "kind" <> 'FEE'
      OR ("name_snapshot" IS NOT NULL AND "quantity" = 1
          AND "variant_id" IS NULL AND "customization_config_id" IS NULL)
    ),
  ADD CONSTRAINT "cart_items_locked_price_check"
    CHECK ("locked_unit_price" IS NULL OR "quote_item_id" IS NOT NULL);

-- Adding the same variant twice increments rather than duplicates.
CREATE UNIQUE INDEX "cart_items_one_line_per_variant"
  ON "cart_items" ("cart_id", "variant_id")
  WHERE "kind" = 'STOCK';

-- ---------------------------------------------------------------------------
-- 3. Order invariants (DATABASE.md section 8)
-- ---------------------------------------------------------------------------

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_totals_check"
    CHECK ("grand_total" = "subtotal" - "discount_total" + "shipping_total" + "tax_total"),
  ADD CONSTRAINT "orders_amount_paid_check" CHECK ("amount_paid" >= 0),
  ADD CONSTRAINT "orders_deposit_check"
    CHECK ("deposit_required" >= 0 AND "deposit_required" <= "grand_total");

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_line_total_check"
    CHECK ("line_total" = "unit_price" * "quantity" - "line_discount"),
  ADD CONSTRAINT "order_items_stock_check"
    CHECK ("kind" <> 'STOCK' OR "variant_id" IS NOT NULL),
  ADD CONSTRAINT "order_items_custom_check"
    CHECK ("kind" <> 'CUSTOM' OR "customization_config_id" IS NOT NULL),
  ADD CONSTRAINT "order_items_fee_check"
    CHECK (
      "kind" <> 'FEE'
      OR ("fee_kind" IS NOT NULL AND "quantity" = 1 AND "requires_production" = false
          AND "product_id" IS NULL AND "variant_id" IS NULL
          AND "customization_config_id" IS NULL)
    );

-- ---------------------------------------------------------------------------
-- 4. Stock reservation (BUSINESS-RULES.md 10.4)
-- ---------------------------------------------------------------------------

-- available = stock_quantity - reserved_quantity, and it may never go negative.
-- The conditional UPDATE in the reservation repository is what prevents
-- overselling; this constraint is what proves the UPDATE was written correctly.
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_reserved_check"
    CHECK ("reserved_quantity" >= 0 AND "reserved_quantity" <= "stock_quantity");
