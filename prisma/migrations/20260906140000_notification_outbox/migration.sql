-- Phase 8A — the notification outbox gains an idempotency key.
--
-- `ARCHITECTURE.md` section 11 already specifies the outbox: a row written in
-- the same transaction as the state change, delivered out of band. The table
-- has existed since the initial migration. What it lacked is the one thing
-- that makes a retry safe — a way to say "this notification already exists".
--
-- `dedupe_key` is that: unique, nullable, and shaped `<template>:<id>`. A
-- second attempt to enqueue the same event violates the constraint, the writer
-- swallows it, and the customer receives one e-mail. Nullable because a future
-- notification that is genuinely repeatable — a digest, say — has no natural
-- key, and PostgreSQL allows any number of NULLs in a unique index.
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" TEXT;

CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- The dispatcher claims work by moving PENDING rows that are due. Ordering by
-- `scheduled_for` is what makes a retry back off rather than spin.
-- `notifications_dispatch_idx` (from the initial migration) already covers
-- `(status, scheduled_for) WHERE status = 'PENDING'`.

-- The workshop's own address, so `request.submitted`, `order.placed` and
-- `quote.expiring` reach a person. Empty by default: the owner fills it in from
-- the admin, and `ADMIN_NOTIFICATION_EMAIL` bootstraps a fresh deployment.
-- `settings.updated_at` is application-managed (`@updatedAt`), so it has no
-- database default and must be supplied here.
INSERT INTO "settings" ("key", "value", "type", "group", "label", "description", "updated_at")
VALUES (
  'notifications.adminRecipients',
  '',
  'STRING',
  'notifications',
  'Adresses de l''atelier',
  'Adresses e-mail prévenues des nouvelles demandes, commandes et devis qui expirent. Séparées par une virgule.',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
