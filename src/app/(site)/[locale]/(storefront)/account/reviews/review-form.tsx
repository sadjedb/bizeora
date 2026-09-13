'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Star } from 'lucide-react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import { cn } from '@/components/ui/cn';
import { RATING_MAX, REVIEW_BODY_MAX, REVIEW_BODY_MIN } from '@/domain/review';
import { useDictionary } from '@/i18n/client';

import { submitReviewAction } from './actions';

/**
 * The review form.
 *
 * The rating is a **radio group**, not five buttons and a piece of state: five
 * mutually exclusive values is exactly what a radio group is, so it arrives
 * keyboard-operable with arrow keys, announced as "3 étoiles sur 5, option 3
 * sur 5", and submitted by a browser with no JavaScript running. The stars are
 * the label's appearance; the input underneath is a real radio.
 *
 * The bounds shown to the customer are `domain/review`'s own constants, so the
 * counter under the box and the rule the server applies cannot drift apart. The
 * server validates regardless — this is a courtesy, not a gate.
 *
 * On success the row disappears from the list, so the form does not try to
 * describe its own new state; it refreshes and the page says what happened.
 */
export function ReviewForm({
  orderItemId,
  productName,
}: {
  orderItemId: string;
  productName: string;
}) {
  const { t } = useDictionary();
  const router = useRouter();
  const groupId = useId();
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<'rating' | 'title' | 'body' | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setField(null);

    startTransition(async () => {
      const result = await submitReviewAction({ orderItemId, rating, title, body });

      if (!result.ok) {
        setError(result.message);
        setField(result.field ?? null);
        return;
      }

      setRating(0);
      setTitle('');
      setBody('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap={5}>
        {error && field !== 'title' && field !== 'body' && (
          <Alert tone="danger" title={t.review.failedTitle}>
            {error}
          </Alert>
        )}

        <fieldset className="border-0 p-0">
          <legend className="text-body-sm text-fg mb-2 font-medium">
            {t.review.ratingFor(productName)}
          </legend>

          <div className="flex flex-wrap items-center gap-1">
            {Array.from({ length: RATING_MAX }, (_, index) => {
              const value = index + 1;
              const id = `${groupId}-${value}`;

              return (
                <span key={value} className="relative size-11">
                  {/*
                   * The input covers the whole 44px target rather than being
                   * `sr-only` beside it: a zero-sized control is one a pointer
                   * cannot reach and a test cannot click, and "the label is
                   * clickable" is not the same guarantee.
                   */}
                  <input
                    type="radio"
                    id={id}
                    name={groupId}
                    value={value}
                    checked={rating === value}
                    onChange={() => setRating(value)}
                    aria-label={t.review.stars(value)}
                    className="peer absolute inset-0 z-10 size-11 cursor-pointer opacity-0"
                  />

                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute inset-0 flex items-center justify-center rounded-sm',
                      'peer-focus-visible:outline-focus peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
                    )}
                  >
                    <Star
                      className={cn(
                        'size-6',
                        value <= rating
                          ? 'fill-accent text-accent'
                          : 'text-border-strong',
                      )}
                    />
                  </span>
                </span>
              );
            })}
          </div>
        </fieldset>

        <FormField
          label={t.review.fieldTitle}
          optional
          {...(field === 'title' && error ? { error } : {})}
        >
          {(props) => (
            <Input
              {...props}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t.review.titlePlaceholder}
            />
          )}
        </FormField>

        <FormField
          label={t.review.fieldBody}
          required
          description={t.review.bodyHint(
            REVIEW_BODY_MIN,
            body.trim().length,
            REVIEW_BODY_MAX,
          )}
          {...(field === 'body' && error ? { error } : {})}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={5}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t.review.bodyPlaceholder}
            />
          )}
        </FormField>

        <Stack gap={2} align="start">
          <Button type="submit" disabled={pending}>
            {pending ? t.review.sending : t.review.send}
          </Button>

          <Text variant="body-sm" tone="subtle">
            {t.review.moderationNote}
          </Text>
        </Stack>
      </Stack>
    </form>
  );
}
