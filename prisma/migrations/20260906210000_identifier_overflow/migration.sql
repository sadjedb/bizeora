-- Human identifiers must not wrap at ten thousand.
--
-- `next_order_number()` and `next_request_number()` formatted the sequence with
-- `lpad(n::text, 4, '0')`. PostgreSQL's `lpad` **truncates** a string longer
-- than the requested length, so the ten-thousandth number came out as the first
-- four of its digits — `10464` became `1046` — and collided with a number
-- already issued. The failure is a unique-constraint violation on
-- `custom_requests_request_number_key` at the moment a customer submits, which
-- is the worst place for it and the last place anybody would look.
--
-- The correction is to pad to a width that is never shorter than the number
-- itself: `lpad(n, GREATEST(4, length(n)), '0')`, so `5` is `0005` and `10464`
-- is `10464`. `to_char(n, 'FM0000')` looks like the obvious fix and is not —
-- PostgreSQL renders `####` when a value overflows a numeric format, which
-- would have replaced a truncated number with a meaningless one.
--
-- The format of every number issued so far is unchanged, which matters because
-- these are printed on confirmations and quoted on the telephone (ADR-023).
--
-- Found by the Phase 14 test run, whose repeated end-to-end passes pushed the
-- request sequence past 9999 on the development database. Nothing about SEO
-- caused it; the defect has been latent since Phase 8.

CREATE OR REPLACE FUNCTION next_order_number() RETURNS text
  LANGUAGE sql VOLATILE
  AS $$
    SELECT 'CMD-' || to_char(now(), 'YYYY') || '-'
        || (SELECT lpad(v::text, GREATEST(4, length(v::text)), '0')
              FROM (SELECT nextval('order_number_seq') AS v) AS issued);
  $$;

CREATE OR REPLACE FUNCTION next_request_number() RETURNS text
  LANGUAGE sql VOLATILE
  AS $$
    SELECT 'DEM-' || to_char(now(), 'YYYY') || '-'
        || (SELECT lpad(v::text, GREATEST(4, length(v::text)), '0')
              FROM (SELECT nextval('request_number_seq') AS v) AS issued);
  $$;

-- The sequences have run ahead of the numbers actually stored, because every
-- collision consumed a value. Move each one past the highest number in use so
-- the next issue is free, rather than colliding until it catches up.
SELECT setval(
  'request_number_seq',
  GREATEST(
    (SELECT last_value FROM "request_number_seq"),
    COALESCE(
      (SELECT MAX(NULLIF(regexp_replace(substring("request_number" from 10), '\D', '', 'g'), '')::bigint)
         FROM "custom_requests"),
      0
    ) + 1
  ),
  true
);

SELECT setval(
  'order_number_seq',
  GREATEST(
    (SELECT last_value FROM "order_number_seq"),
    COALESCE(
      (SELECT MAX(NULLIF(regexp_replace(substring("order_number" from 10), '\D', '', 'g'), '')::bigint)
         FROM "orders"),
      0
    ) + 1
  ),
  true
);
