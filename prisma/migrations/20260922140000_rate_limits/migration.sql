-- ---------------------------------------------------------------------------
-- Rate limiting, in Postgres.
--
-- `SECURITY.md` section 9 has specified a table of limits since Phase 0 and
-- section 3 recorded the gap plainly: "Login throttling — **not yet
-- implemented**". This is the counter behind it.
--
-- ## Postgres, not Redis
--
-- Section 9 names "Upstash Redis behind an adapter, with a Postgres fallback so
-- a Redis outage degrades to slower limiting rather than to none". The fallback
-- is what is built first, and deliberately: there is no Redis in this
-- deployment, and a limiter that exists only in a service nobody has signed up
-- for is a limiter that is not enforcing anything. The adapter seam is in
-- `lib/rate-limit`, so adding Redis later is a second implementation of one
-- interface rather than a change at every call site.
--
-- A single-instance shop doing tens of requests a minute does not need Redis to
-- count to five. It needs the counting to happen at all.
--
-- ## A fixed window, and why the bucket is in the key
--
-- The key is `<action>:<subject>:<bucket>`, where the bucket is the window's
-- start in whole seconds. That turns "increment a counter for the current
-- window" into a plain upsert:
--
--     INSERT ... VALUES (key, 1) ON CONFLICT (key) DO UPDATE SET count = count + 1
--
-- which is atomic under concurrency without a transaction, a lock or a
-- read-modify-write that two requests can both win. The alternative — one row
-- per subject with a `window_start` column — needs a CASE in the UPDATE and
-- gets the boundary wrong under load.
--
-- A fixed window allows a burst across a boundary: five attempts at 14:59 and
-- five more at 15:00. A sliding window would not, and costs a row per attempt.
-- For "stop credential stuffing" and "stop storage exhaustion", the fixed
-- window is the right side of that trade; the limits are set with the burst in
-- mind.
--
-- ## Expiry
--
-- Rows are dead the moment their window closes. `expires_at` is indexed so the
-- sweep is one ranged delete, and the limiter runs it opportunistically rather
-- than needing a scheduled job to keep the table from growing.
-- ---------------------------------------------------------------------------

CREATE TABLE "rate_limits" (
  "key"        TEXT PRIMARY KEY,
  "count"      INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ(6) NOT NULL
);

CREATE INDEX "rate_limits_expires_at_idx" ON "rate_limits" ("expires_at");

-- A counter that has gone backwards is a bug that would silently stop limiting.
ALTER TABLE "rate_limits"
  ADD CONSTRAINT "rate_limits_count_positive" CHECK ("count" >= 0);
