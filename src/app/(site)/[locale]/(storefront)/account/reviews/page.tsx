import type { Metadata } from 'next';

import { dictionaryFor } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { redirect } from 'next/navigation';

import { Badge, EmptyState } from '@/components/ui/feedback';
import { Card, CardBody } from '@/components/ui/card';
import { Heading, Text } from '@/components/ui/typography';
import { Inline, Stack } from '@/components/layout/layout';
import { Link } from '@/components/ui/link';
import { ProductImage } from '@/components/media/product-image';
import { ReviewStars } from '@/components/commerce/rating';
import { requireCustomer } from '@/server/auth/guards';
import {
  listReviewableItems,
  listReviewsByAuthor,
} from '@/server/repositories/review-repository';

import { ReviewForm } from './review-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { t } = dictionaryFor((await params).locale);
  return { title: t.account.reviews, robots: { index: false, follow: false } };
}

/**
 * The customer's reviews.
 *
 * Two lists. **What you can review** is every line of your own delivered orders
 * that names a catalogue product and that you have not reviewed — 11A.1 and
 * 11A.2 as a query, scoped by `order.userId` inside it. **What you have
 * written** shows each review with its moderation status, because a customer
 * who writes something and never sees it again reasonably concludes it was
 * lost.
 *
 * A guest purchaser has no rows here at all, and that is 11A.4 rather than a
 * bug: a guest order carries no `userId`, so it matches nobody. The claim flow
 * — creating an account — is the documented path, not a policy change.
 */
export const dynamic = 'force-dynamic';

export default async function AccountReviewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale, t } = dictionaryFor((await params).locale);
  const authorisation = await requireCustomer();

  if (!authorisation.ok) {
    redirect(
      authorisation.reason === 'UNAUTHENTICATED' ? '/login?next=/account/reviews' : '/',
    );
  }

  const userId = authorisation.actor.userId;

  const [pendingItems, written] = await Promise.all([
    listReviewableItems({ userId }),
    listReviewsByAuthor({ userId }),
  ]);

  return (
    <Stack gap={12}>
      <Stack gap={4}>
        <Heading level={1} variant="display-md">
          {t.account.reviews}
        </Heading>
        <Text variant="body" tone="muted" className="max-w-prose">
          {t.review.lead}
        </Text>
      </Stack>

      <Stack gap={6}>
        <Heading level={2} variant="heading-lg">
          {t.review.toReview}
        </Heading>

        {pendingItems.length === 0 ? (
          <EmptyState
            title={t.account.reviewsEmptyTitle}
            description={t.account.reviewsEmptyBody}
            action={
              <Link href="/account/orders" variant="subtle">
                {t.review.seeOrders}
              </Link>
            }
          />
        ) : (
          <Stack gap={6}>
            {pendingItems.map((item) => (
              <Card key={item.orderItemId}>
                <CardBody>
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="w-20 shrink-0">
                      <ProductImage
                        src={item.image?.src ?? null}
                        alt={item.image?.alt ?? item.productName}
                        ratio="square"
                        sizes="80px"
                      />
                    </div>

                    <Stack gap={1} className="min-w-0 flex-1">
                      <Heading level={3} variant="heading-md">
                        {item.productName}
                      </Heading>
                      <Text variant="body-sm" tone="subtle">
                        {[item.variantLabel, t.review.orderReference(item.orderNumber)]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </Stack>
                  </div>

                  <ReviewForm
                    orderItemId={item.orderItemId}
                    productName={item.productName}
                  />
                </CardBody>
              </Card>
            ))}
          </Stack>
        )}
      </Stack>

      <Stack gap={6}>
        <Heading level={2} variant="heading-lg">
          {t.review.published}
        </Heading>

        {written.length === 0 ? (
          <Text variant="body-sm" tone="subtle">
            {t.review.noneWritten}
          </Text>
        ) : (
          <ul className="divide-border flex list-none flex-col divide-y p-0">
            {written.map((review) => (
              <li key={review.id} className="flex flex-col gap-3 py-6 first:pt-0">
                <Inline gap={3} align="center">
                  <ReviewStars rating={review.rating} />
                  <Badge variant={review.status === 'APPROVED' ? 'solid' : 'outline'}>
                    {t.labels.reviewStatus[review.status]}
                  </Badge>
                </Inline>

                <Heading level={3} variant="heading-md">
                  <Link href={`/shop/${review.productSlug}`} variant="subtle">
                    {review.productName}
                  </Link>
                </Heading>

                {review.title && (
                  <Text variant="body" tone="muted">
                    {review.title}
                  </Text>
                )}

                <Text variant="body-sm" tone="muted" className="whitespace-pre-line">
                  {review.body}
                </Text>

                <Text variant="body-sm" tone="subtle">
                  {t.review.writtenOn(formatDate(review.createdAt, locale))}
                  {review.status === 'PENDING' && t.account.reviewPending}
                </Text>

                {review.adminResponse && (
                  <div className="border-border bg-surface rounded-md border p-4">
                    <Stack gap={2}>
                      <Text variant="body-sm" tone="subtle">
                        {t.review.workshopReply}
                      </Text>
                      <Text
                        variant="body-sm"
                        tone="muted"
                        className="whitespace-pre-line"
                      >
                        {review.adminResponse}
                      </Text>
                    </Stack>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </Stack>
  );
}
