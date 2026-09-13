-- ---------------------------------------------------------------------------
-- An e-mail address is no longer required to place an order.
--
-- The column was NOT NULL on the reasoning that it "carries the confirmation
-- and is the basis for later account claiming". Both are true and neither makes
-- it mandatory **in Algeria, paying cash on delivery**. A great many customers
-- here order by phone and have no working e-mail address; asking for one as a
-- hard requirement turns them away at the last screen, which is the most
-- expensive place a shop can lose somebody.
--
-- What replaces it is what was already true operationally: **the phone number
-- is the contact.** It is NOT NULL, it is indexed for guest lookup, and it is
-- what the workshop actually rings when a delivery needs arranging.
--
-- What an order without an address loses, stated plainly:
--
--   * no e-mail confirmation, and no status e-mails afterwards. The
--     notification outbox skips a row with no recipient rather than failing —
--     the order number on the confirmation screen is the receipt.
--   * no claiming by e-mail later. A guest order is reached by its guest token
--     as before, and by its phone number from the workshop's side.
--
-- A **quote-derived** order is unaffected: it belongs to an account, and that
-- account's address is used rather than anything typed at checkout.
-- ---------------------------------------------------------------------------

ALTER TABLE "orders" ALTER COLUMN "contact_email" DROP NOT NULL;

-- An address that is present must still look like one. Empty string is not a
-- missing e-mail — it is a missing e-mail that every `IS NOT NULL` check will
-- believe, so it is forbidden outright.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_contact_email_not_blank"
  CHECK ("contact_email" IS NULL OR length(btrim("contact_email")) > 0);
