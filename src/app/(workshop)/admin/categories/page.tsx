import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FolderPlus } from 'lucide-react';

import { Badge, EmptyState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Link } from '@/components/ui/link';
import { PageHeader } from '@/components/ui/page-header';
import { Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import {
  Table,
  TableBody,
  TableCell,
  TableCellMeta,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowLink,
} from '@/components/ui/table';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import { listAdminCategoryRows } from '@/server/repositories/catalogue-admin-repository';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();
  return { title: t.admin.navCategories };
}

export const dynamic = 'force-dynamic';

/**
 * The shelves of the shop.
 *
 * A category has existed in the schema since Phase 2 and every product points
 * at one, but until now the only way to make one was a SQL client — which is
 * why the product form carried a warning saying so. This is the screen that
 * warning pointed at.
 *
 * **Two counts per row, and they answer different questions.** "Produits" is
 * how much work is in the category; "En ligne" is how much of it a customer can
 * see, and it is the number that decides whether the category may be hidden.
 * Showing only the first would make the refusal on the form look arbitrary.
 *
 * No archiving and no bulk selection here, unlike the queues. A category is not
 * a queue — there are four of them, they are edited once a season, and the
 * reversible act they need is the `isActive` switch on the form.
 */
export default async function CategoriesPage() {
  const { t } = await workshopDictionary();

  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const categories = await listAdminCategoryRows();

  return (
    <Stack gap={6}>
      <PageHeader
        title={t.admin.categories}
        description={t.admin.categoriesLead}
        actions={
          <Button asChild>
            <Link href="/admin/categories/new" variant="plain">
              <FolderPlus className="size-4" aria-hidden="true" />
              {t.admin.newCategory}
            </Link>
          </Button>
        }
      />

      {categories.length === 0 ? (
        <EmptyState
          title={t.admin.noCategoriesTitle}
          description={t.admin.noCategoriesBody}
          action={
            <Button asChild>
              <Link href="/admin/categories/new" variant="plain">
                {t.admin.newCategory}
              </Link>
            </Button>
          }
        />
      ) : (
        <Table caption={t.admin.categories}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t.admin.fieldCategory}</TableHeaderCell>
              <TableHeaderCell align="end" numeric>
                {t.admin.fieldCategoryPosition}
              </TableHeaderCell>
              <TableHeaderCell align="end" numeric>
                {t.admin.navProducts}
              </TableHeaderCell>
              <TableHeaderCell align="end">{t.admin.colLiveProducts}</TableHeaderCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {categories.map((category) => (
              <TableRow key={category.id}>
                <TableCell label={t.admin.fieldCategory} bare>
                  <TableRowLink href={`/admin/categories/${category.id}`}>
                    {category.name}
                  </TableRowLink>
                  <TableCellMeta>/shop/c/{category.slug}</TableCellMeta>
                </TableCell>

                <TableCell label={t.admin.fieldCategoryPosition} align="end" numeric>
                  {category.position}
                </TableCell>

                <TableCell label={t.admin.navProducts} align="end" numeric>
                  {category.products}
                </TableCell>

                <TableCell label={t.admin.colLiveProducts} align="end">
                  <span className="inline-flex items-center gap-2">
                    <span className="tabular-nums">{category.liveProducts}</span>
                    {!category.isActive && (
                      <Badge tone="neutral">{t.admin.categoryInactive}</Badge>
                    )}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Text variant="body-sm" tone="subtle" className="max-w-prose">
        {t.admin.categoryActiveHint}
      </Text>
    </Stack>
  );
}
