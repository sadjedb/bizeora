-- Better Auth schema reconciliation (Phase 2.3, ADR-006 amended).
--
-- Transforms the Phase 2 hand-designed identity tables into Better Auth
-- 1.7.2's core schema, so that Phase 3 can attach the library's Prisma adapter
-- without a second migration. See docs/DATABASE.md section 4.
--
-- Destructive changes, and why they are safe here:
--
--   users.password_hash        dropped. The Argon2id credential hash moves to
--                              accounts.password on the credential account row.
--   users.email_verified_at    dropped. Better Auth owns verification state and
--                              writes the boolean users.email_verified; a
--                              timestamp it never writes would stay NULL for
--                              ever. Verification events are audit_logs' job.
--   users.first_name/last_name dropped in favour of Better Auth's single
--                              `name`. Nothing consumed them: every form in
--                              docs/UX.md collects a full name, and addresses
--                              carry their own full_name for the recipient.
--   sessions.token_hash        replaced by sessions.token. Better Auth looks a
--                              session up by equality on the raw token, so a
--                              hash column has no lookup path.
--   sessions.last_active_at    dropped. Rolling refresh moves expires_at.
--   verification_tokens        replaced by the generic `verification` table.
--                              Single-use consumption is Better Auth's atomic
--                              delete-on-read, not a consumed_at column.
--   accounts.*                 renamed and widened to Better Auth's shape.
--
-- The new NOT NULL columns (users.name, sessions.token) and the tightening of
-- users.email are written without a backfill on purpose. These four tables are
-- empty: prisma/seed.ts seeds reference and configuration data only and creates
-- no users, sessions, accounts or verifications, so there is no data to
-- migrate and inventing a placeholder backfill would only hide a real failure.
-- If a developer created rows by hand, this migration fails loudly, which is
-- the correct outcome.

-- DropForeignKey
ALTER TABLE "verification_tokens" DROP CONSTRAINT "verification_tokens_user_id_fkey";

-- DropIndex
DROP INDEX "accounts_provider_id_provider_account_id_key";

-- DropIndex
DROP INDEX "sessions_token_hash_key";

-- AlterTable
ALTER TABLE "accounts" DROP COLUMN "expires_at",
DROP COLUMN "provider_account_id",
ADD COLUMN     "access_token_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "account_id" TEXT NOT NULL,
ADD COLUMN     "id_token" TEXT,
ADD COLUMN     "issuer" TEXT,
ADD COLUMN     "password" TEXT,
ADD COLUMN     "refresh_token_expires_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "last_active_at",
DROP COLUMN "token_hash",
ADD COLUMN     "token" TEXT NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "email_verified_at",
DROP COLUMN "first_name",
DROP COLUMN "last_name",
DROP COLUMN "password_hash",
ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "image" TEXT,
ADD COLUMN     "name" TEXT NOT NULL,
ALTER COLUMN "email" SET NOT NULL;

-- DropTable
DROP TABLE "verification_tokens";

-- DropEnum
DROP TYPE "verification_token_type";

-- CreateTable
CREATE TABLE "verification" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "verification_expires_at_idx" ON "verification"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts"("provider_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");
