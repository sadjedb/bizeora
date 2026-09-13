/**
 * Empty the shop of transactions, and leave the catalogue standing.
 *
 * Between a test run and a demonstration the database fills with other
 * people's evidence: orders from `amina@example.invalid`, ninety requests all
 * from "Amina Bensalem", carts nobody owns. None of it is wrong, and all of it
 * is the first thing somebody sees on the workshop's dashboard.
 *
 *     npm run db:clear
 *
 * What goes: orders, payments, quotes, requests, carts, design files,
 * customisation configurations, notifications, audit entries, reviews and the
 * accounts that made them.
 *
 * What stays: products and their photography, categories, placements,
 * embroidery sizes, thread colours, wilayas, shipping zones, settings, the
 * homepage bands and the gallery — everything `db:seed` would put back anyway,
 * so the shop is a shop the moment this finishes rather than a blank page.
 *
 * Deliberately **not** `migrate reset`: that drops the schema and takes the
 * administrator account with it, and wanting an empty order list is not wanting
 * to sign up again.
 */

import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Children before parents, in one transaction.
 *
 * The order is the foreign-key graph read backwards. It is written out rather
 * than derived because a wrong order here fails loudly on a constraint, which
 * is the correct outcome — a clever generic version would be a different way to
 * get it wrong.
 */
const TABLES = [
  'order_status_history',
  'payments',
  'order_payment_proofs',
  'order_items',
  'order_addresses',
  'orders',
  'quote_items',
  'quotes',
  'custom_request_events',
  'custom_request_items',
  'custom_requests',
  'cart_items',
  'carts',
  'customization_files',
  'customization_thread_colors',
  'customization_configs',
  'design_files',
  'notifications',
  'analytics_events',
  'reviews',
  'wishlist_items',
  'coupon_redemptions',
  'inventory_adjustments',
  'audit_logs',
  'addresses',
  'sessions',
  'accounts',
  'verification',
  'users',
] as const;

async function main(): Promise<void> {
  const keepAdmins = !process.argv.includes('--all-users');

  await prisma.$transaction(async (tx) => {
    for (const table of TABLES) {
      /*
       * The staff keep their accounts unless asked otherwise.
       *
       * Wiping the order list should not sign the owner out of their own
       * workshop. `--all-users` is there for a genuinely blank start.
       */
      if (table === 'users' && keepAdmins) {
        const removed = await tx.$executeRawUnsafe(
          `DELETE FROM "users" WHERE "role" = 'CUSTOMER'`,
        );
        if (removed > 0)
          console.info(`${String(removed).padStart(6)}  users (customers)`);
        continue;
      }

      const removed = await tx.$executeRawUnsafe(`DELETE FROM "${table}"`);
      if (removed > 0) console.info(`${String(removed).padStart(6)}  ${table}`);
    }
  });

  const [products, images] = await Promise.all([
    prisma.product.count(),
    prisma.productImage.count(),
  ]);

  console.info(`\nCatalogue intact: ${products} products, ${images} photographs.`);
  if (keepAdmins)
    console.info('Staff and admin accounts kept. Use --all-users to drop them too.');
}

main()
  .catch((error: unknown) => {
    console.error('Clear failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
