-- Phase 12 — admin operations.
--
-- Two things the admin workspace needs that the schema has never carried:
--
--   1. **Proof of payment.** `BUSINESS-RULES.md` 8.10.2 makes it an upload
--      against the *order*, under the same private-file rules as design files.
--      It is its own table rather than a column on `payments` because it exists
--      before a payment does: the customer submits it, and recording a payment
--      is the admin's answer to it (8.10.4).
--
--   2. **Money invariants on `payments`.** 8.8 derives `paymentStatus` from
--      succeeded payments less refunds, which is only meaningful if every row
--      carries a positive amount. A refund is a `REFUND` row of positive
--      magnitude, subtracted by the domain — never a negative payment.

-- ---------------------------------------------------------------------------
-- 1. Proof of payment
-- ---------------------------------------------------------------------------

CREATE TYPE "payment_proof_status" AS ENUM ('SUBMITTED', 'ACCEPTED', 'REJECTED');

CREATE TABLE "order_payment_proofs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "order_id" UUID NOT NULL,
    "design_file_id" UUID NOT NULL,
    "submitted_by_user_id" UUID,
    "status" "payment_proof_status" NOT NULL DEFAULT 'SUBMITTED',
    "rejection_reason" TEXT,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_payment_proofs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_payment_proofs_design_file_id_key"
  ON "order_payment_proofs"("design_file_id");

CREATE INDEX "order_payment_proofs_order_id_created_at_idx"
  ON "order_payment_proofs"("order_id", "created_at");

ALTER TABLE "order_payment_proofs"
  ADD CONSTRAINT "order_payment_proofs_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- RESTRICT, not CASCADE: a file that is somebody's evidence of payment must
  -- not disappear because a sweep tidied the design-file table.
  ADD CONSTRAINT "order_payment_proofs_design_file_id_fkey"
    FOREIGN KEY ("design_file_id") REFERENCES "design_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "order_payment_proofs_submitted_by_user_id_fkey"
    FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "order_payment_proofs_reviewed_by_user_id_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A refusal without a stated reason is a customer left guessing (8.10.4).
ALTER TABLE "order_payment_proofs"
  ADD CONSTRAINT "order_payment_proofs_rejection_check"
    CHECK ("status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL),
  ADD CONSTRAINT "order_payment_proofs_review_check"
    CHECK ("status" = 'SUBMITTED' OR "reviewed_at" IS NOT NULL);

-- At most one proof awaiting review per order: two would make "the proof" an
-- ambiguous phrase in the workspace that reviews it.
CREATE UNIQUE INDEX "order_payment_proofs_one_pending_per_order"
  ON "order_payment_proofs" ("order_id")
  WHERE "status" = 'SUBMITTED';

-- ---------------------------------------------------------------------------
-- 2. Payment invariants (BUSINESS-RULES.md 8.8)
-- ---------------------------------------------------------------------------

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);

-- 8.8's arithmetic is over **succeeded** rows, and the admin queue reads the
-- outstanding ones. Both are per-order.
CREATE INDEX "payments_order_status_idx" ON "payments" ("order_id", "status");

-- ---------------------------------------------------------------------------
-- 3. The admin queues (DATABASE.md section 8)
-- ---------------------------------------------------------------------------

-- 8.10.5 flags an order left in AWAITING_PAYMENT past the deposit window. The
-- queue that finds them orders by age within a status.
CREATE INDEX "orders_awaiting_payment_idx"
  ON "orders" ("placed_at")
  WHERE "status" = 'AWAITING_PAYMENT';
