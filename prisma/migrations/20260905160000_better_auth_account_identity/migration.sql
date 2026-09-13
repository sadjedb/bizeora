-- Better Auth account identity correction (Phase 3, ADR-019).
--
-- Phase 2.3 modelled `accounts` from research rather than from the installed
-- package. Reading better-auth 1.7.2's own table definition
-- (@better-auth/core/dist/db/get-tables.mjs) shows two differences that matter:
--
--   1. `issuer` is `required: true`. It is not decoration: `updatePassword`
--      filters on `issuer = 'local:credential'` alongside userId, providerId
--      and accountId, so a credential row with a NULL issuer can never have its
--      password changed — the update would silently match zero rows.
--
--   2. The account identity key is `(issuer, accountId)`, not
--      `(providerId, accountId)`. The library declares that unique index
--      itself, and `local:` / `local:oauth:` issuer prefixes are what keep a
--      local provider id from colliding with an OAuth one.
--
-- The table is empty (Phase 2.3 introduced it and nothing writes accounts until
-- this phase), so `SET NOT NULL` needs no backfill.

-- DropIndex
DROP INDEX "accounts_provider_id_account_id_key";

-- AlterTable
ALTER TABLE "accounts" ALTER COLUMN "issuer" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "accounts_issuer_account_id_key" ON "accounts"("issuer", "account_id");
