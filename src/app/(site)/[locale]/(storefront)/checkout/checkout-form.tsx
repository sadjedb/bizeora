'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import { Alert } from '@/components/ui/feedback';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { FormField } from '@/components/ui/field';
import { Heading, Text } from '@/components/ui/typography';
import { Input, RadioField, SelectField, Textarea } from '@/components/ui/input';
import { Stack } from '@/components/layout/layout';
import { Price } from '@/components/commerce/price';

import { OrderSummary } from '../cart/summary';
import { useDictionary } from '@/i18n/client';
import type { Dictionary } from '@/i18n';
import { placeOrderAction, quoteDeliveryAction } from './actions';

/**
 * The checkout form.
 *
 * `UX.md` section 7: one page, three sections, no wizard — contact, delivery,
 * payment, with a summary that is sticky on desktop.
 *
 * The division of labour matches the builder's. This component collects
 * **inputs**: a name, a phone, an address, a wilaya, a delivery type, a payment
 * method. Every number it displays came from the server, including the delivery
 * charge, which is re-quoted whenever the wilaya changes. It cannot compute a
 * total, and there is no field in the payload where one could be sent.
 */

export type DeliveryOption = {
  deliveryType: 'HOME' | 'DESK';
  amount: number;
  isFree: boolean;
  estimatedMinDays: number;
  estimatedMaxDays: number;
  remainingForFree: number | null;
  label: string;
  /** The server's totals for this choice. This component never adds up money. */
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  depositRequired: number;
};

export type CheckoutFormProps = {
  wilayas: readonly { code: number; name: string }[];
  paymentMethods: readonly ('COD' | 'BANK_TRANSFER' | 'CCP')[];
  currency: string;
  subtotal: number;
  discountTotal: number;
  discountBasisPoints: number;
  /** Subtotal less discount, computed server-side, shown before a wilaya is chosen. */
  preDeliveryTotal: number;
  totalCustomUnits: number;
  hasCustomLine: boolean;
  hasProductionLine: boolean;
  hasStockLine: boolean;
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
    // Not translated: CCP is the name of an Algerian postal account, the way
    // IBAN is a name rather than a word.
    CCP: { label: 'CCP', description: t.checkout.payDetailsAfter },
  };
}

type Errors = Partial<Record<string, string>>;

export function CheckoutForm(props: CheckoutFormProps) {
  const { t } = useDictionary();
  const PAYMENT_LABELS = paymentLabels(t);

  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [wilayaCode, setWilayaCode] = useState<string>('');
  const [communeName, setCommuneName] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [deliveryType, setDeliveryType] = useState<'HOME' | 'DESK'>('HOME');
  const [paymentMethod, setPaymentMethod] = useState<string>(
    props.paymentMethods[0] ?? '',
  );
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [options, setOptions] = useState<readonly DeliveryOption[] | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);

  /**
   * Re-quote delivery whenever the wilaya changes.
   *
   * The dependency is the wilaya alone. Nothing else in this form can change a
   * delivery price, and including more would re-ask the server for an answer it
   * already gave.
   */
  useEffect(() => {
    if (!wilayaCode) return;

    let cancelled = false;

    void quoteDeliveryAction({ wilayaCode: Number(wilayaCode) }).then((result) => {
      if (cancelled) return;

      if (!result.ok) {
        setOptions(null);
        setDeliveryError(result.message);
        return;
      }

      setDeliveryError(null);
      setOptions(result.options);

      // Keep a selection that still exists; otherwise take the first offered.
      // A functional update reads the current value without making it a
      // dependency, which would re-ask the server for an answer it just gave.
      setDeliveryType((current) =>
        result.options.some((option) => option.deliveryType === current)
          ? current
          : (result.options[0]?.deliveryType ?? current),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [wilayaCode]);

  /**
   * The selected option carries its own totals, computed by the server through
   * the 5.1 pipeline. Nothing on this page adds a subtotal to a shipping
   * charge: before a wilaya is chosen there is no total to show, and once one
   * is, the total is the server's.
   */
  const selected =
    options?.find((option) => option.deliveryType === deliveryType) ?? null;

  function validate(): boolean {
    const next: Errors = {};
    if (contactName.trim().length < 2) next.contactName = t.checkout.errName;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      next.contactEmail = t.checkout.errEmail;
    }
    if (contactPhone.replace(/[\s.-]/g, '').length < 9) {
      next.contactPhone = t.checkout.errPhone;
    }
    if (!wilayaCode) next.wilayaCode = t.checkout.errWilaya;
    if (communeName.trim().length < 2) next.communeName = t.checkout.errCommune;
    if (addressLine.trim().length < 5) next.addressLine = t.checkout.errAddress;
    if (!termsAccepted) next.termsAccepted = t.checkout.errTerms;

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function submit() {
    setFormError(null);
    if (!validate()) return;

    startTransition(async () => {
      const result = await placeOrderAction({
        contactName,
        contactEmail,
        contactPhone,
        wilayaCode: Number(wilayaCode),
        communeName,
        addressLine,
        deliveryType,
        paymentMethod,
        // The note field went with Phase 14.11: it duplicated the
        // instructions the builder already captures, and a cash-on-delivery
        // checkout is short on purpose. The column stays for the quote path.
        customerNote: null,
        termsAccepted: true,
      });

      // A success redirects and never returns, so anything here is a refusal.
      if (result && !result.ok) setFormError(result.message);
    });
  }

  useEffect(() => {
    if (formError) errorRef.current?.focus();
  }, [formError]);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
      <Stack gap={8}>
        <div ref={errorRef} tabIndex={-1}>
          {formError && (
            <Alert tone="danger" title={t.checkout.failedTitle}>
              {formError}
            </Alert>
          )}
        </div>

        <Card>
          <CardBody>
            <Stack gap={5}>
              <Heading level={2} variant="heading-sm">
                {t.checkout.step1}
              </Heading>

              <FormField label={t.checkout.fullName} error={errors.contactName} required>
                {(field) => (
                  <Input
                    {...field}
                    value={contactName}
                    autoComplete="name"
                    onChange={(event) => setContactName(event.target.value)}
                  />
                )}
              </FormField>

              {/*
               * Optional, and second to the phone.
               *
               * Cash on delivery in Algeria is arranged by telephone; an
               * e-mail address is a convenience for the customer who has one,
               * not a condition of buying. It keeps its position out of habit,
               * but it no longer stops anybody at the last screen.
               */}
              <FormField
                label={t.checkout.email}
                description={t.checkout.emailHelp}
                error={errors.contactEmail}
                optional
              >
                {(field) => (
                  <Input
                    {...field}
                    type="email"
                    value={contactEmail}
                    autoComplete="email"
                    onChange={(event) => setContactEmail(event.target.value)}
                  />
                )}
              </FormField>

              <FormField
                label={t.checkout.phone}
                description={t.checkout.phoneHelp}
                error={errors.contactPhone}
                required
              >
                {(field) => (
                  <Input
                    {...field}
                    type="tel"
                    value={contactPhone}
                    autoComplete="tel"
                    placeholder="0555 12 34 56"
                    onChange={(event) => setContactPhone(event.target.value)}
                  />
                )}
              </FormField>
            </Stack>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <Stack gap={5}>
              <Heading level={2} variant="heading-sm">
                {t.checkout.step2}
              </Heading>

              <FormField label={t.checkout.wilaya} error={errors.wilayaCode} required>
                {(field) => (
                  <SelectField
                    {...field}
                    options={props.wilayas.map((wilaya) => ({
                      value: String(wilaya.code),
                      label: `${wilaya.code} — ${wilaya.name}`,
                    }))}
                    value={wilayaCode}
                    onValueChange={setWilayaCode}
                    placeholder={t.checkout.wilayaPlaceholder}
                  />
                )}
              </FormField>

              {deliveryError && <Alert tone="warning">{deliveryError}</Alert>}

              {options && options.length > 0 && (
                <FormField label={t.checkout.deliveryMode} required>
                  {(field) => (
                    <RadioField
                      name="deliveryType"
                      aria-label={t.checkout.deliveryMode}
                      aria-describedby={field['aria-describedby']}
                      value={deliveryType}
                      onValueChange={(value) => setDeliveryType(value as 'HOME' | 'DESK')}
                      options={options.map((option) => ({
                        value: option.deliveryType,
                        label:
                          option.deliveryType === 'HOME'
                            ? t.checkout.atHome
                            : t.checkout.atDesk,
                        description: (
                          <>
                            {option.isFree ? (
                              t.checkout.free
                            ) : (
                              <Price
                                amount={option.amount}
                                currency={props.currency}
                                size="sm"
                              />
                            )}
                            {' · '}
                            {option.estimatedMinDays}–{option.estimatedMaxDays}{' '}
                            {t.checkout.daysAfterConfirmation}
                          </>
                        ),
                      }))}
                    />
                  )}
                </FormField>
              )}

              <FormField label={t.checkout.commune} error={errors.communeName} required>
                {(field) => (
                  <Input
                    {...field}
                    value={communeName}
                    autoComplete="address-level2"
                    onChange={(event) => setCommuneName(event.target.value)}
                  />
                )}
              </FormField>

              <FormField
                label={t.checkout.address}
                description={t.checkout.addressHelp}
                error={errors.addressLine}
                required
              >
                {(field) => (
                  <Textarea
                    {...field}
                    rows={3}
                    value={addressLine}
                    autoComplete="street-address"
                    onChange={(event) => setAddressLine(event.target.value)}
                  />
                )}
              </FormField>
            </Stack>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <Stack gap={5}>
              <Heading level={2} variant="heading-sm">
                {t.checkout.step3}
              </Heading>

              {props.hasCustomLine && (
                <Alert tone="info" title={t.checkout.customOrderTitle}>
                  {t.checkout.customOrderBody}
                </Alert>
              )}

              <FormField label={t.checkout.paymentMode} required>
                {(field) => (
                  <RadioField
                    name="paymentMethod"
                    aria-label={t.checkout.paymentMode}
                    aria-describedby={field['aria-describedby']}
                    value={paymentMethod}
                    onValueChange={setPaymentMethod}
                    options={props.paymentMethods.map((method) => ({
                      value: method,
                      label: PAYMENT_LABELS[method]!.label,
                      description: PAYMENT_LABELS[method]!.description,
                    }))}
                  />
                )}
              </FormField>

              <FormField
                label={t.checkout.termsLabel}
                error={errors.termsAccepted}
                required
              >
                {(field) => (
                  <label className="flex min-h-11 items-start gap-3">
                    <input
                      id={field.id}
                      type="checkbox"
                      className="mt-1 size-5 shrink-0"
                      checked={termsAccepted}
                      aria-describedby={field['aria-describedby']}
                      aria-invalid={field['aria-invalid']}
                      onChange={(event) => setTermsAccepted(event.target.checked)}
                    />
                    <Text variant="body-sm">{t.checkout.terms}</Text>
                  </label>
                )}
              </FormField>
            </Stack>
          </CardBody>
        </Card>
      </Stack>

      <Card className="lg:sticky lg:top-24">
        <CardBody>
          <Stack gap={5}>
            <Heading level={2} variant="heading-sm">
              {t.checkout.summary}
            </Heading>

            <OrderSummary
              currency={props.currency}
              subtotal={props.subtotal}
              discountTotal={props.discountTotal}
              discountBasisPoints={props.discountBasisPoints}
              totalCustomUnits={props.totalCustomUnits}
              shippingTotal={selected ? selected.amount : null}
              grandTotal={selected ? selected.grandTotal : props.preDeliveryTotal}
              depositRequired={selected ? selected.depositRequired : 0}
            />

            {props.hasProductionLine && props.hasStockLine && (
              <Text variant="body-sm" tone="muted">
                {t.checkout.shipsTogether}
              </Text>
            )}

            <Button fullWidth loading={pending} onClick={submit} disabled={!selected}>
              {t.checkout.confirm}
            </Button>

            {!selected && (
              <Text variant="body-sm" tone="muted">
                {t.checkout.chooseWilayaFirst}
              </Text>
            )}

            <Text variant="caption" tone="subtle">
              {t.cart.serverPriced}
            </Text>
          </Stack>
        </CardBody>
      </Card>
    </div>
  );
}
