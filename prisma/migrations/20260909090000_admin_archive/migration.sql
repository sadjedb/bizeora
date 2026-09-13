-- ---------------------------------------------------------------------------
-- Archiving — queue hygiene for the workshop's lists.
--
-- Until now nothing in the admin could be taken off a screen. Requests that
-- went nowhere, quotes that were refused, orders from a day of testing: all of
-- them stayed in the queue for ever, and the only way to clear one was a SQL
-- client. Phase 14.9 gives the workshop a way to say "I am done with this row".
--
-- **It hides, it does not destroy.** `archived_at` is read by the admin's own
-- lists and by nothing else: the customer's order page still renders, the
-- payment totals still count it, the history is untouched, and restoring is one
-- click. That is the whole reason this is a timestamp on the row rather than a
-- DELETE — a deleted order is a receipt the shop can no longer produce, and an
-- archived one is a receipt nobody has to look at today. See ADR-034.
--
-- Four tables, because those are the four the workshop works from as queues.
-- Products already archive through `products.status`, which is a different and
-- customer-facing thing: an archived product leaves the shop. An archived order
-- does not leave anything.
-- ---------------------------------------------------------------------------

ALTER TABLE "orders" ADD COLUMN "archived_at" TIMESTAMPTZ(6);
ALTER TABLE "custom_requests" ADD COLUMN "archived_at" TIMESTAMPTZ(6);
ALTER TABLE "quotes" ADD COLUMN "archived_at" TIMESTAMPTZ(6);
ALTER TABLE "reviews" ADD COLUMN "archived_at" TIMESTAMPTZ(6);

-- Partial indexes, on the half that is read.
--
-- Every admin list asks for "not archived" and orders by date; the archived
-- view is opened rarely and by hand. Indexing `WHERE archived_at IS NULL` keeps
-- the index the size of the working set rather than the size of the table,
-- which is the point of a queue that is cleared.
CREATE INDEX "orders_active_placed_at_idx"
  ON "orders" ("placed_at" DESC) WHERE "archived_at" IS NULL;

CREATE INDEX "custom_requests_active_created_at_idx"
  ON "custom_requests" ("created_at" DESC) WHERE "archived_at" IS NULL;

CREATE INDEX "quotes_active_created_at_idx"
  ON "quotes" ("created_at" DESC) WHERE "archived_at" IS NULL;

CREATE INDEX "reviews_active_created_at_idx"
  ON "reviews" ("created_at" DESC) WHERE "archived_at" IS NULL;

-- And the archived half, for the view that lists it.
CREATE INDEX "orders_archived_at_idx" ON "orders" ("archived_at");
CREATE INDEX "custom_requests_archived_at_idx" ON "custom_requests" ("archived_at");
CREATE INDEX "quotes_archived_at_idx" ON "quotes" ("archived_at");
CREATE INDEX "reviews_archived_at_idx" ON "reviews" ("archived_at");
