import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/feedback';
import { Link } from '@/components/ui/link';
import { PageHeader } from '@/components/ui/page-header';
import { Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import { mayManageContent } from '@/domain/permissions';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import {
  listAllBanners,
  listAllSections,
} from '@/server/repositories/content-admin-repository';

import { BannerEditor } from './banner-editor';
import { SectionList } from './section-list';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();
  return { title: t.admin.navHomepage };
}

export const dynamic = 'force-dynamic';

/**
 * The landing page, as something the owner edits.
 *
 * `ADR-027` made the homepage rows rather than literals so that reordering it
 * would be an `UPDATE` rather than a deploy. Until now there was no screen for
 * that update, which meant the promise was theoretical: changing a headline
 * needed a developer and a database client.
 *
 * What is editable here is everything the page renders about itself — the order
 * of the bands, which are shown at all, every piece of copy **in both
 * languages**, the hero photograph, how many products or gallery pieces each
 * grid shows, and the promotional strip along the top.
 *
 * What is deliberately not editable is the *shape* of a band. The eleven types
 * are the page's vocabulary and each has a layout, an accessibility contract
 * and a set of states that were designed; a screen that let somebody assemble
 * arbitrary blocks would be a page builder, and a page builder's output looks
 * like a page builder's output.
 */
export default async function AdminContentPage() {
  const { t } = await workshopDictionary();
  const authorisation = await requireStaff();
  if (!authorisation.ok || !mayManageContent(authorisation.actor)) notFound();

  const [sections, banners] = await Promise.all([listAllSections(), listAllBanners()]);

  return (
    <Stack gap={8}>
      <PageHeader title={t.admin.navHomepage} description={t.admin.contentLead} />

      <Alert tone="neutral" title={t.admin.contentLiveTitle}>
        {t.admin.contentLiveBefore}
        <Link href="/fr" external>
          {t.admin.contentLiveLink}
        </Link>
        {t.admin.contentLiveAfter}
      </Alert>

      <SectionList sections={sections} />

      <Stack gap={3}>
        <Text variant="heading-md" as="h2">
          {t.admin.bannerHeading}
        </Text>
        <Text variant="body-sm" tone="muted" className="max-w-prose">
          {t.admin.bannerLead}
        </Text>
        <BannerEditor banners={banners} />
      </Stack>
    </Stack>
  );
}
