import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { Link } from '@/components/ui/link';
import { PageHeader } from '@/components/ui/page-header';
import { Stack } from '@/components/layout/layout';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import { getAdminCategory } from '@/server/repositories/catalogue-admin-repository';

import { CategoryForm } from '../category-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}): Promise<Metadata> {
  const { t } = await workshopDictionary();
  const category = await getAdminCategory((await params).categoryId);

  return { title: category ? category.name : t.admin.editCategory };
}

export const dynamic = 'force-dynamic';

/**
 * One category.
 *
 * The form, plus the two things the form cannot say on its own: a link to the
 * public page so the operator can see what they are editing, and a warning when
 * the category is visible but holds nothing a customer can see — which is a
 * chip leading to an empty shelf, and the reason `listCatalogueCategories`
 * leaves such categories out of the storefront entirely.
 */
export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  const { t } = await workshopDictionary();

  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const category = await getAdminCategory((await params).categoryId);
  if (!category) notFound();

  return (
    <Stack gap={6}>
      <Breadcrumbs
        items={[
          { label: t.admin.categories, href: '/admin/categories' },
          { label: category.name },
        ]}
      />

      <PageHeader
        title={category.name}
        description={`/shop/c/${category.slug}`}
        actions={
          category.isActive && category.liveProducts > 0 ? (
            <Link href={`/fr/shop/c/${category.slug}`} variant="subtle">
              {t.admin.viewCategoryOnSite}
            </Link>
          ) : undefined
        }
      />

      {category.isActive && category.liveProducts === 0 && (
        <Alert tone="warning" title={t.admin.categoryEmptyWarning}>
          {t.admin.noCategoriesBody}
        </Alert>
      )}

      <CategoryForm
        liveProducts={category.liveProducts}
        values={{
          id: category.id,
          name: category.name,
          slug: category.slug,
          description: category.description ?? '',
          position: String(category.position),
          isActive: category.isActive,
          seoTitle: category.seoTitle ?? '',
          seoDescription: category.seoDescription ?? '',
          translations: category.translations,
        }}
      />
    </Stack>
  );
}
