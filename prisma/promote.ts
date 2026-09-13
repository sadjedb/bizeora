/**
 * Give an existing account the ADMIN role.
 *
 * The seed deliberately creates no administrator (`DATABASE.md` section 19): an
 * account seeded with a known password is a back door that ships, and the first
 * administrator has to be a real person who registered with a real password
 * through the real form.
 *
 * That leaves a gap the moment the database is reset — there is a workshop and
 * nobody who may open it — and closing it by hand means a psql session and an
 * `UPDATE users SET role`, which is the sort of thing that gets pasted into the
 * wrong terminal. This is that one statement, and nothing else.
 *
 *     npm run db:admin -- someone@example.com
 *
 * It **promotes**, it never creates: the account must already exist, so a typo
 * is a refusal rather than a dormant row nobody can sign in to.
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

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error('Usage: npm run db:admin -- you@example.com');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) {
    console.error(`No account for ${email}. Register at /register first, then run this.`);
    process.exitCode = 1;
    return;
  }

  if (user.role === 'ADMIN') {
    console.info(`${user.email} is already an administrator.`);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });

  console.info(`${user.email} (${user.name}) is now an administrator.`);
  // The session carries the role, so one already open is still a customer's.
  console.info('Sign out and back in — the role is baked into the session.');
}

main()
  .catch((error: unknown) => {
    console.error('Promotion failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
