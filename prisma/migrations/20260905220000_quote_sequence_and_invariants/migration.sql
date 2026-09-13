-- Phase 10 — quotes.
--
-- Phase 8 left `quoteNumber` deliberately, having established the pattern for
-- the other two identifiers (ADR-023). This is the third and last of them.
--
-- The format `DATABASE.md` section 10 documents is "Q-1042-v2": a **base**
-- belonging to the whole family of quotes for one request, and a version
-- suffix. So the sequence yields the base and the domain formats the number —
-- version 2 of quote 1042 reuses base 1042 rather than taking a new one, which
-- is the point of the format.

CREATE SEQUENCE IF NOT EXISTS "quote_number_seq" AS bigint START WITH 1000;

-- Starting at 1000 so the first quote reads Q-1000 rather than Q-1: a
-- four-digit reference looks like a reference, and a customer reading "quote
-- Q-1" aloud learns how many quotes the business has ever sent.
CREATE OR REPLACE FUNCTION next_quote_base() RETURNS bigint
  LANGUAGE sql VOLATILE
  AS $$ SELECT nextval('quote_number_seq'); $$;

-- ---------------------------------------------------------------------------
-- Quote invariants (DATABASE.md section 10)
-- ---------------------------------------------------------------------------

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_valid_until_check"
    CHECK ("valid_until" > "created_at"),
  ADD CONSTRAINT "quotes_acceptance_check"
    CHECK ("acceptance_valid_until" IS NULL OR "accepted_at" IS NOT NULL);

-- 7.2: at most one quote per request may be in SENT or VIEWED. Two live quotes
-- for one request means two prices a customer could accept, and the second
-- acceptance would have nothing to reconcile against.
CREATE UNIQUE INDEX "quotes_one_outstanding_per_request"
  ON "quotes" ("request_id")
  WHERE "status" IN ('SENT', 'VIEWED');

-- The two expiry jobs' indexes (section 10), plus the lazy checks that make
-- those jobs optional for correctness.
CREATE INDEX "quotes_outstanding_validity_idx"
  ON "quotes" ("valid_until")
  WHERE "status" IN ('SENT', 'VIEWED');

CREATE INDEX "quotes_acceptance_validity_idx"
  ON "quotes" ("acceptance_valid_until")
  WHERE "status" = 'ACCEPTED';

-- ---------------------------------------------------------------------------
-- Quote line invariants
-- ---------------------------------------------------------------------------

ALTER TABLE "quote_items"
  ADD CONSTRAINT "quote_items_line_total_check"
    CHECK ("line_total" = "unit_price" * "quantity"),
  ADD CONSTRAINT "quote_items_quantity_check"
    CHECK ("quantity" > 0),
  -- `unitPrice` may be negative only on a DISCOUNT line (DATABASE.md section
  -- 10). A positive discount is a discount that adds money.
  ADD CONSTRAINT "quote_items_sign_check"
    CHECK (
      ("kind" = 'DISCOUNT' AND "unit_price" < 0)
      OR ("kind" <> 'DISCOUNT' AND "unit_price" >= 0)
    ),
  -- 2.6.5 maps each fee to one order item with quantity 1, and the order-item
  -- check enforces that. A fee quoted at quantity 3 could not survive
  -- acceptance, so it cannot be quoted in the first place.
  ADD CONSTRAINT "quote_items_fee_quantity_check"
    CHECK ("kind" NOT IN ('SETUP_FEE', 'DIGITIZING', 'RUSH_FEE', 'OTHER') OR "quantity" = 1);

-- ---------------------------------------------------------------------------
-- Freezing (ADR-016, BUSINESS-RULES 7.2.1)
-- ---------------------------------------------------------------------------

-- A frozen configuration is one a sent quote has priced. Nothing may edit it
-- afterwards; an edit clones it instead. The application enforces that, and
-- this index is what makes "is it frozen" cheap on every write path.
CREATE INDEX "customization_configs_frozen_idx"
  ON "customization_configs" ("frozen_at")
  WHERE "frozen_at" IS NOT NULL;
