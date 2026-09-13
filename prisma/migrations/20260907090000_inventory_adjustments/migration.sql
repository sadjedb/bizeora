-- ---------------------------------------------------------------------------
-- Inventory adjustments — the stock ledger.
--
-- Phase 14.5 gave the workshop a screen that changes `stock_quantity`. Until
-- now that column only ever moved as a consequence of something the system
-- could explain: a reservation at order confirmation, a decrement at shipment,
-- a release at cancellation (BUSINESS-RULES.md 10.4 and 10.5). Every one of
-- those has an order behind it, so "why is this 7?" always had an answer.
--
-- A manual adjustment has no such trail. Without a ledger the answer to "who
-- set this to 7, when, and why" is nowhere in the system, which is exactly the
-- question somebody asks on the day the count is wrong. `audit_logs` is the
-- wrong home for it: it is admin-only (12.1) while stock is staff work, and its
-- JSON metadata cannot be aggregated into "the last ten movements on this SKU",
-- which is what the person holding the clipboard actually needs.
--
-- Append-only by intent. There is no update path and no delete path in the
-- repository: a mistaken adjustment is corrected by a compensating adjustment
-- with reason CORRECTION, the way a ledger has always worked. See ADR-029.
-- ---------------------------------------------------------------------------

CREATE TYPE "inventory_adjustment_reason" AS ENUM (
  'RECEIVED',
  'COUNT',
  'DAMAGED',
  'RETURNED',
  'CORRECTION'
);

CREATE TABLE "inventory_adjustments" (
  "id"                 UUID PRIMARY KEY DEFAULT uuidv7(),
  "variant_id"         UUID NOT NULL,
  -- Signed, and never zero: an adjustment that changes nothing is a mistake,
  -- not a record worth keeping.
  "delta"              INTEGER NOT NULL,
  -- The quantity after this movement, recorded at the time. Denormalised on
  -- purpose: replaying deltas to reconstruct a count is only correct if no
  -- other write ever touched the column, and shipments do.
  "resulting_quantity" INTEGER NOT NULL,
  "reason"             "inventory_adjustment_reason" NOT NULL,
  "note"               TEXT,
  -- SET NULL rather than CASCADE: the movement happened even if the account
  -- that made it is later removed. The ledger outlives the staff list.
  "actor_user_id"      UUID,
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  -- ON UPDATE CASCADE is Prisma's default for a relation, and writing it out is
  -- what keeps `migrate diff` quiet: a hand-written migration that omits it
  -- leaves the database one clause away from the schema for ever.
  CONSTRAINT "inventory_adjustments_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,

  CONSTRAINT "inventory_adjustments_delta_not_zero" CHECK ("delta" <> 0),
  -- The same floor the domain enforces, restated where it cannot be bypassed.
  CONSTRAINT "inventory_adjustments_resulting_not_negative"
    CHECK ("resulting_quantity" >= 0)
);

-- The variant's history, newest first: the only way this table is read.
-- Named the way Prisma names an @@index, so the schema and the database agree.
CREATE INDEX "inventory_adjustments_variant_id_created_at_idx"
  ON "inventory_adjustments" ("variant_id", "created_at" DESC);
