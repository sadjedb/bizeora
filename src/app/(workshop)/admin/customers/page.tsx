import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Search, Users } from 'lucide-react';

import { Badge, EmptyState } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  TableToolbar,
} from '@/components/ui/table';
import { formatDate } from '@/i18n/format';
import { workshopDictionary } from '@/i18n/server';
import { requireStaff } from '@/server/auth/guards';
import { listCustomersForStaff } from '@/server/repositories/user-repository';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await workshopDictionary();
  return { title: t.admin.navCustomers };
}

export const dynamic = 'force-dynamic';

/**
 * The customer directory.
 *
 * A `GET` form rather than a client-side filter, so a search is a URL: the
 * owner can bookmark one, share it, and come back to it. The query is bounded
 * and executed server-side (`ARCHITECTURE.md` section 6) — nothing is filtered
 * in the browser, which would mean shipping every customer's address to it.
 *
 * **Nothing about authentication is on this screen.** No password state, no
 * session list, no verification token — only whether the address is confirmed,
 * which is a commercial fact (it gates quote acceptance) rather than a
 * credential. `SECURITY.md` section 4 keeps the two apart.
 *
 * `UX.md` section 9 also describes a **guest half** — contacts grouped by phone
 * across `orders`. It is not built here; only registered accounts are listed,
 * and that limitation is recorded rather than papered over.
 */
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale, t } = await workshopDictionary();
  const authorisation = await requireStaff();
  if (!authorisation.ok) notFound();

  const { q } = await searchParams;
  const query = q?.trim() ?? '';

  const customers = await listCustomersForStaff({ query: query || null });

  return (
    <Stack gap={6}>
      <PageHeader
        title="Clients"
        description="Les comptes clients enregistrés, avec leurs demandes et leurs commandes. Les commandes passées en invité ne sont pas encore regroupées ici."
      />

      <TableToolbar
        actions={
          <form
            method="get"
            action="/admin/customers"
            role="search"
            className="flex items-center gap-2"
          >
            <label htmlFor="customer-search" className="sr-only">
              Rechercher un client
            </label>
            <Input
              id="customer-search"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Nom ou adresse e-mail"
              maxLength={120}
              className="md:w-64"
            />
            <Button type="submit" variant="secondary">
              <Search className="size-4" aria-hidden="true" />
              <span className="sr-only md:not-sr-only">Rechercher</span>
            </Button>
          </form>
        }
      >
        <Text variant="body-sm" tone="subtle">
          {customers.length === 1 ? '1 compte' : `${customers.length} comptes`}
          {query ? ` correspondant à « ${query} »` : ''}
        </Text>
      </TableToolbar>

      {customers.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={query ? t.admin.noResults : t.admin.noCustomers}
          description={query ? t.admin.noCustomerMatches : t.admin.customersAppearHere}
        />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-md border max-md:border-0 max-md:bg-transparent">
          <Table caption="Comptes clients">
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t.admin.colCustomer}</TableHeaderCell>
                <TableHeaderCell>Adresse</TableHeaderCell>
                <TableHeaderCell align="end" numeric>
                  Commandes
                </TableHeaderCell>
                <TableHeaderCell align="end" numeric>
                  Demandes
                </TableHeaderCell>
                <TableHeaderCell align="end">{t.admin.colLastActivity}</TableHeaderCell>
                <TableHeaderCell align="end">Compte</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell label={t.admin.colCustomer} bare>
                    <TableRowLink href={`/admin/customers/${customer.id}`}>
                      {customer.name ?? customer.email}
                    </TableRowLink>
                    <TableCellMeta>
                      client depuis le {formatDate(customer.createdAt, locale, 'medium')}
                    </TableCellMeta>
                  </TableCell>
                  <TableCell label="Adresse">
                    <span className="break-all">{customer.email}</span>
                  </TableCell>
                  <TableCell label="Commandes" align="end" numeric>
                    {customer.orderCount}
                  </TableCell>
                  <TableCell label="Demandes" align="end" numeric>
                    {customer.requestCount}
                  </TableCell>
                  <TableCell label={t.admin.colLastActivity} align="end">
                    {customer.lastOrderAt ? (
                      <Text variant="caption" tone="subtle" as="span">
                        {formatDate(customer.lastOrderAt, locale, 'medium')}
                      </Text>
                    ) : (
                      <Text variant="caption" tone="subtle" as="span">
                        {t.admin.noOrders}
                      </Text>
                    )}
                  </TableCell>
                  <TableCell label="Compte" align="end">
                    <Badge tone={customer.emailVerified ? 'positive' : 'attention'}>
                      {customer.emailVerified ? t.admin.customerConfirmed : 'À confirmer'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Stack>
  );
}
