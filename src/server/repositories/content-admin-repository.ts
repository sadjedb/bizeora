import 'server-only';

import { prisma } from '@/lib/db/client';
import { isHomepageSectionType, type HomepageSection } from '@/domain/content';

/**
 * The front page, as the owner edits it.
 *
 * The storefront's own repository reads **enabled** sections only, because a
 * disabled band is one somebody decided not to show and "fetched then filtered"
 * is one forgotten line away from showing it. This module is the other half: it
 * reads everything, including what is switched off, because a screen that hides
 * the switched-off bands is a screen with no way to switch them back on.
 *
 * Writes are deliberately narrow. There is no "create section" and no "delete
 * section": the eleven band types are the page's vocabulary and each exists
 * once (`ADR-027`), so what the owner does is turn one on, reorder it, and
 * change its words. A screen that could delete the hero would be a screen that
 * can leave the shop without a front page.
 */

export type AdminSectionRow = HomepageSection & {
  updatedAt: Date;
};

const SECTION_SELECT = {
  id: true,
  type: true,
  position: true,
  isEnabled: true,
  title: true,
  subtitle: true,
  body: true,
  ctaLabel: true,
  ctaHref: true,
  imageKey: true,
  config: true,
  updatedAt: true,
} as const;

/** Every band, in order, switched on or off. */
export async function listAllSections(): Promise<readonly AdminSectionRow[]> {
  const rows = await prisma.homepageSection.findMany({
    select: SECTION_SELECT,
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });

  return rows.flatMap((row) =>
    isHomepageSectionType(row.type) ? [{ ...row, type: row.type }] : [],
  );
}

export async function findSection(id: string): Promise<AdminSectionRow | null> {
  const row = await prisma.homepageSection.findUnique({
    where: { id },
    select: SECTION_SELECT,
  });

  if (!row || !isHomepageSectionType(row.type)) return null;

  return { ...row, type: row.type };
}

export type SectionWrite = {
  title: string | null;
  subtitle: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  config: Record<string, unknown>;
};

/**
 * Write one band's copy and configuration.
 *
 * The whole `config` object is replaced rather than merged, because the caller
 * built it from the row it was editing: a merge would make removing a key
 * impossible, and "clear this field" is a thing the owner will want on the day
 * they take a promotional note down.
 */
export async function updateSection(
  id: string,
  write: SectionWrite,
): Promise<{ ok: boolean }> {
  const existing = await prisma.homepageSection.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) return { ok: false };

  await prisma.homepageSection.update({
    where: { id },
    data: {
      title: write.title,
      subtitle: write.subtitle,
      body: write.body,
      ctaLabel: write.ctaLabel,
      ctaHref: write.ctaHref,
      config: write.config as never,
    },
  });

  return { ok: true };
}

export async function setSectionEnabled(
  id: string,
  isEnabled: boolean,
): Promise<{ ok: boolean }> {
  const existing = await prisma.homepageSection.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) return { ok: false };

  await prisma.homepageSection.update({ where: { id }, data: { isEnabled } });
  return { ok: true };
}

/**
 * Write a whole new order, 0…n, in one transaction.
 *
 * The caller computed the sequence with `movedOrder`, the same pure helper the
 * product gallery uses. Writing every position rather than swapping two makes
 * the result independent of what the positions were before — including the
 * duplicates a hand-edited database can hold.
 */
export async function reorderSections(orderedIds: readonly string[]): Promise<void> {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.homepageSection.update({ where: { id }, data: { position: index } }),
    ),
  );
}

/* ---------------------------------------------------------------------------
 * The banner strip
 * ------------------------------------------------------------------------ */

export type AdminBannerRow = {
  id: string;
  message: string;
  href: string | null;
  isActive: boolean;
  position: number;
};

export async function listAllBanners(): Promise<readonly AdminBannerRow[]> {
  return prisma.banner.findMany({
    select: { id: true, message: true, href: true, isActive: true, position: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
}

export async function updateBanner(
  id: string,
  write: { message: string; href: string | null; isActive: boolean },
): Promise<{ ok: boolean }> {
  const existing = await prisma.banner.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) return { ok: false };

  await prisma.banner.update({ where: { id }, data: write });
  return { ok: true };
}

export async function createBanner(write: {
  message: string;
  href: string | null;
  isActive: boolean;
}): Promise<AdminBannerRow> {
  const last = await prisma.banner.findFirst({
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  return prisma.banner.create({
    data: { ...write, position: (last?.position ?? -1) + 1 },
    select: { id: true, message: true, href: true, isActive: true, position: true },
  });
}

export async function deleteBanner(id: string): Promise<void> {
  await prisma.banner.deleteMany({ where: { id } });
}
