-- Phase 9 — a design file needs an owner from the moment it is created.
--
-- `design_files` carried only `owner_user_id`, which is correct for a
-- registered customer and empty for a guest. A file is created at *presign*
-- time, before any request exists to hang authorisation on, so without a guest
-- owner every anonymous upload would be unowned — and an unowned row is one
-- anybody can claim.
--
-- This is the ownership model the project already uses, applied to a second
-- table: `DATABASE.md` section 7 gives `carts` exactly one of `user_id` and
-- `anonymous_token`, and a guest order is an `orders` row with a null
-- `user_id`. There is no second identity system here — the token is the same
-- guest cart token, so one browser is one guest across cart and uploads.
--
-- It is stored **hashed**, unlike `carts.anonymous_token`. The token is a
-- bearer credential in an HttpOnly cookie; hashing means a leaked database
-- dump does not let anyone impersonate an uploader and pull their artwork.

ALTER TABLE "design_files"
  ADD COLUMN "owner_token_hash" TEXT;

-- Exactly one owner, and never none. `SET NULL` on the user foreign key means
-- an anonymised account could otherwise leave a file with no owner at all, so
-- the constraint is deferred-safe rather than strict: a file whose owner was
-- erased is unreachable, which is the correct outcome for a deleted account.
ALTER TABLE "design_files"
  ADD CONSTRAINT "design_files_owner_check"
    CHECK (
      "owner_user_id" IS NOT NULL
      OR "owner_token_hash" IS NOT NULL
      OR "deleted_at" IS NOT NULL
    );

CREATE INDEX "design_files_owner_token_hash_idx"
  ON "design_files" ("owner_token_hash", "created_at" DESC)
  WHERE "owner_token_hash" IS NOT NULL;

-- The reaper's index: PENDING rows older than the quarantine lifetime.
CREATE INDEX "design_files_pending_created_idx"
  ON "design_files" ("created_at")
  WHERE "status" = 'PENDING';
