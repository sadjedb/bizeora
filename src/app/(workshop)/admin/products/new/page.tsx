import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Stack } from '@/components/layout/layout';
import { DEFAULT_STOCK_POLICY } from '@/domain/catalogue';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import { listAdminCategories } from '@/server/repositories/catalogue-admin-repository';

import { ProductForm } from '../product-form';

export const metadata: Metadata = { title: 'Nouveau produit' };

export const dynamic = 'force-dynamic';

/**
 * Creating a product.
 *
 * It opens as a **draft**, under **`MADE_TO_ORDER`**. Both defaults are chosen
 * rather than inherited: a half-filled product should not be reachable from the
 * storefront while somebody is still writing it, and 10.8 says a blank the
 * business sources per job must not be stock-tracked, because tracking it turns
 * a sourcing question into a hard checkout failure. `TRACK` is a deliberate
 * choice, made on this form, and never the path of least resistance.
 *
 * A product cannot be created with variants, because a variant needs option
 * values that do not exist until the product does. The form therefore hands off
 * to the product's own page, where options, variants and stock live.
 */
export default async function NewProductPage() {
  const { t } = await workshopDictionary();
  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const categories = await listAdminCategories();

  return (
    <Stack gap={6}>
      <Breadcrumbs
        items={[
          { label: 'Produits', href: '/admin/products' },
          { label: 'Nouveau produit' },
        ]}
      />

      <PageHeader title={t.admin.newProduct} description={t.admin.newProductLead} />

      {categories.length === 0 ? (
        <Alert tone="warning" title={t.admin.noCategory}>
          {t.admin.noCategoryBody}
        </Alert>
      ) : (
        <ProductForm
          currency="DZD"
          categories={categories}
          values={{
            id: null,
            name: '',
            slug: '',
            subtitle: '',
            description: '',
            categoryId: '',
            status: 'DRAFT',
            basePrice: '',
            compareAtPrice: '',
            stockPolicy: DEFAULT_STOCK_POLICY,
            material: '',
            careInstructions: '',
            embroideryDetails: '',
            isCustomizable: false,
            isFeatured: false,
            isNewArrival: false,
            isBestSeller: false,
            seoTitle: '',
            seoDescription: '',
            translations: null,
          }}
        />
      )}
    </Stack>
  );
}
