'use client';

import { Badge } from '@/components/ui/feedback';
import { useDictionary } from '@/i18n/client';
import { Heading, Text } from '@/components/ui/typography';
import { Container, Section, Stack } from '@/components/layout/layout';
import { Link } from '@/components/ui/link';
import { RatingBreakdown, ReviewStars } from '@/components/commerce/rating';
import type { ProductReviewPanel } from '@/server/repositories/review-repository';

/**
 * Reviews, on the product page.
 *
 * Only approved reviews reach here — the clause is in the query, not in this
 * component (`review-repository`) — and each one carries a display name, a
 * date, its stars and the workshop's public reply when there is one. There is
 * no author identifier, no e-mail and no moderation trail in the DTO, so there
 * is none to leak.
 *
 * **The body is rendered as text, never as markup.** React escapes it, and
 * nothing here calls `dangerouslySetInnerHTML`. A review is the one string on
 * the storefront written by somebody outside the business, and it is treated
 * accordingly (`SECURITY.md` section 12).
 *
 * With no approved reviews the section still renders — as an invitation rather
 * than a gap. A product nobody has reviewed is a normal state, and hiding the
 * heading makes the page look as though reviews are not a thing here.
 */

const DATE = new Intl.DateTimeFormat('fr-DZ', { dateStyle: 'long' });

export function ProductReviews({ panel }: { panel: ProductReviewPanel }) {
  const { summary, reviews } = panel;

  const { t } = useDictionary();

  return (
    <Section as="section" className="border-border border-t">
      <Container>
        <Stack gap={10}>
          <Heading level={2} variant="display-md">
            {t.product.reviewsTitle}
          </Heading>

          {summary.count === 0 ? (
            <Stack gap={3} className="max-w-prose">
              <Text variant="body" tone="muted">
                {t.product.noReviews}
              </Text>
              <Text variant="body-sm" tone="subtle">
                {t.product.reviewsOnlyDelivered}
              </Text>
            </Stack>
          ) : (
            <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
              <div className="lg:col-span-4">
                <RatingBreakdown
                  average={summary.average}
                  count={summary.count}
                  distribution={summary.distribution}
                />

                <Text variant="body-sm" tone="subtle" className="mt-4">
                  {t.product.reviewsVerifiedCount(summary.count)}
                </Text>
              </div>

              <div className="lg:col-span-8">
                <ul className="divide-border flex list-none flex-col divide-y p-0">
                  {reviews.map((review) => (
                    <li key={review.id} className="flex flex-col gap-3 py-6 first:pt-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <ReviewStars rating={review.rating} />
                        {review.isVerifiedPurchase && (
                          <Badge variant="outline">{t.product.verifiedPurchase}</Badge>
                        )}
                      </div>

                      {review.title && (
                        <Heading level={3} variant="heading-md">
                          {review.title}
                        </Heading>
                      )}

                      <Text variant="body" tone="muted" className="whitespace-pre-line">
                        {review.body}
                      </Text>

                      <Text variant="body-sm" tone="subtle">
                        {review.authorName} · {DATE.format(review.createdAt)}
                      </Text>

                      {review.adminResponse && (
                        <div className="border-border bg-surface mt-1 rounded-md border p-4">
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
              </div>
            </div>
          )}

          <Text variant="body-sm" tone="subtle">
            {t.product.reviewsPrompt}{' '}
            <Link href="/account/reviews" variant="subtle">
              {t.product.reviewsPromptLink}
            </Link>
            .
          </Text>
        </Stack>
      </Container>
    </Section>
  );
}
