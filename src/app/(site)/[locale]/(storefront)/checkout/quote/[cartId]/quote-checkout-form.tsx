'use client';

import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { FormField } from '@/components/ui/field';
import { Heading, Text } from '@/components/ui/typography';
import { Input, RadioField, SelectField, Textarea } from '@/components/ui/input';
import { Stack } from '@/components/layout/layout';
import { useDictionary } from '@/i18n/client';
import type { Dictionary } from '@/i18n';

import { placeQuoteOrderAction } from './actions';

/**
 * The quote-bound checkout form.
 *
 * `UX.md` section 7: "the wilaya selector still appears for the address, but it
 * does not reprice". That sentence is the whole difference between this form
 * and the standard one — there is no delivery quote call here, no repricing on
 * change, and no total that moves. Delivery is the quote's `SHIPPING` total
 * (5A.3), shown by the page above this form and not editable from it.
 *
 * There are no quantity steppers, no add-item control and no coupon field.
 * Their absence is explained in one line on the page rather than left as a
 * puzzle, and the server refuses every one of them regardless (5A.1, 5A.4).
 */

export type QuoteCheckoutFormProps = {
  cartId: string;
  wilayas: readonly { code: number; name: string }[];
  paymentMethods: readonly ('COD' | 'BANK_TRANSFER' | 'CCP')[];
  defaultName: string;
  defaultEmail: string;
};

function paymentLabels(
  t: Dictionary,
): Record<string, { label: string; description: string }> {
  return {
    COD: { label: t.checkout.payCod, description: t.checkout.payCodHint },
    BANK_TRANSFER: {
      label: t.checkout.payTransfer,
      description: t.checkout.payDetailsAfter,
    },
    CCP: {
      label: t.labels.paymentMethod.CCP,
      description: t.checkout.payCcpHint,
    },
  };
}

export function QuoteCheckoutForm({
  cartId,
  wilayas,
  paymentMethods,
  defaultName,
  defaultEmail,
}: QuoteCheckoutFormProps) {
  const { t } = useDictionary();
  const paymentOptions = paymentLabels(t);
  const [message, setMessage] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>(paymentMethods[0] ?? '');
  const [wilayaCode, setWilayaCode] = useState('');
  const [deliveryType, setDeliveryType] = useState<'HOME' | 'DESK'>('HOME');
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setMessage(null);

    startTransition(async () => {
      const result = await placeQuoteOrderAction(cartId, {
        contactName: String(data.get('contactName') ?? ''),
        contactEmail: String(data.get('contactEmail') ?? ''),
        contactPhone: String(data.get('contactPhone') ?? ''),
        wilayaCode: Number(wilayaCode),
        communeName: String(data.get('communeName') ?? ''),
        addressLine: String(data.get('addressLine') ?? ''),
        deliveryType,
        paymentMethod,
        customerNote: String(data.get('customerNote') ?? '') || null,
        termsAccepted: data.get('termsAccepted') === 'on',
      });

      if (result && !result.ok) setMessage(result.message);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap={6}>
        {message && (
          <Alert tone="danger" title={t.checkout.quoteFailed}>
            {message}
          </Alert>
        )}

        <Card>
          <CardBody>
            <Stack gap={5}>
              <Heading level={2} variant="heading-md">
                {t.checkout.contact}
              </Heading>

              <FormField label={t.checkout.fullName} required>
                {(props) => (
                  <Input
                    {...props}
                    name="contactName"
                    autoComplete="name"
                    defaultValue={defaultName}
                    minLength={2}
                    maxLength={120}
                    required
                  />
                )}
              </FormField>

              <FormField
                label={t.checkout.email}
                required
                description={t.checkout.emailConfirmationHelp}
              >
                {(props) => (
                  <Input
                    {...props}
                    name="contactEmail"
                    type="email"
                    autoComplete="email"
                    defaultValue={defaultEmail}
                    maxLength={255}
                    required
                  />
                )}
              </FormField>

              <FormField label={t.checkout.phone} required>
                {(props) => (
                  <Input
                    {...props}
                    name="contactPhone"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    required
                  />
                )}
              </FormField>
            </Stack>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <Stack gap={5}>
              <Heading level={2} variant="heading-md">
                {t.checkout.shipping}
              </Heading>

              <Text variant="body-sm" tone="muted">
                {t.checkout.quoteShippingFixed}
              </Text>

              <FormField label={t.checkout.wilaya} required>
                {(props) => (
                  <SelectField
                    {...props}
                    value={wilayaCode}
                    onValueChange={setWilayaCode}
                    placeholder={t.checkout.wilayaPlaceholder}
                    options={wilayas.map((wilaya) => ({
                      value: String(wilaya.code),
                      label: `${wilaya.code} — ${wilaya.name}`,
                    }))}
                  />
                )}
              </FormField>

              <FormField label={t.checkout.commune} required>
                {(props) => (
                  <Input
                    {...props}
                    name="communeName"
                    minLength={2}
                    maxLength={120}
                    required
                  />
                )}
              </FormField>

              <FormField label={t.checkout.address} required>
                {(props) => (
                  <Input
                    {...props}
                    name="addressLine"
                    autoComplete="street-address"
                    minLength={5}
                    maxLength={300}
                    required
                  />
                )}
              </FormField>

              <RadioField
                name="deliveryType"
                aria-label={t.checkout.deliveryMode}
                value={deliveryType}
                onValueChange={(value) => setDeliveryType(value as 'HOME' | 'DESK')}
                options={[
                  { value: 'HOME', label: t.checkout.atHome },
                  { value: 'DESK', label: t.checkout.atDesk },
                ]}
              />
            </Stack>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <Stack gap={5}>
              <Heading level={2} variant="heading-md">
                {t.order.payment}
              </Heading>

              <RadioField
                name="paymentMethod"
                aria-label={t.checkout.paymentMode}
                value={paymentMethod}
                onValueChange={setPaymentMethod}
                options={paymentMethods.map((method) => ({
                  value: method,
                  label: paymentOptions[method]?.label ?? method,
                  description: paymentOptions[method]?.description,
                }))}
              />

              <FormField label={t.checkout.note} optional>
                {(props) => (
                  <Textarea {...props} name="customerNote" rows={3} maxLength={1000} />
                )}
              </FormField>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  name="termsAccepted"
                  required
                  className="mt-1 size-5"
                />
                <Text variant="body-sm" as="span">
                  {t.checkout.quoteTerms}
                </Text>
              </label>
            </Stack>
          </CardBody>
        </Card>

        <Button type="submit" variant="primary" loading={pending} fullWidth>
          {t.checkout.quoteConfirm}
        </Button>
      </Stack>
    </form>
  );
}
