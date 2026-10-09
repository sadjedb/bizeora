import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '@/components/ui/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Stack } from '@/components/layout/layout';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import { listAdminCategoryRows } from '@/server/repositories/catalogue-admin-repository';

import { CategoryForm } from '../category-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();
  return { title: t.admin.newCategory };
}

export const dynamic = 'force-dynamic';

/**
 * Creating a category.
 *
 * It opens **visible**, which is the opposite of the product form's default and
 * right for the same reason that one is wrong: a half-written product should
 * not be reachable, but a category is only ever reachable through the products
 * inside it, and there are none yet. A hidden new category would simply not
 * appear anywhere until somebody noticed the switch.
 *
 * The position is suggested as the end of the row, because a new shelf goes at
 * the end unless somebody says otherwise.
 */
export default async function NewCategoryPage() {
  const { t } = await workshopDictionary();

  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const existing = await listAdminCategoryRows();
  const nextPosition = existing.reduce(
    (highest, category) => Math.max(highest, category.position + 1),
    0,
  );

  return (
    <Stack gap={6}>
      <Breadcrumbs
        items={[
          { label: t.admin.categories, href: '/admin/categories' },
          { label: t.admin.newCategory },
        ]}
      />

      <PageHeader title={t.admin.newCategory} description={t.admin.newCategoryLead} />

      <CategoryForm
        liveProducts={0}
        values={{
          id: null,
          name: '',
          slug: '',
          description: '',
          position: String(nextPosition),
          isActive: true,
          seoTitle: '',
          seoDescription: '',
          translations: null,
        }}
      />
    </Stack>
  );
}
