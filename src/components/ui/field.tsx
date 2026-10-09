'use client';

import { createContext, useContext, useId, type ReactNode } from 'react';

import { useDictionary } from '@/i18n/client';
import { cn } from '@/components/ui/cn';
import { Label, Text } from '@/components/ui/typography';

/**
 * FormField — the wiring that makes an accessible form control accessible.
 *
 * Section 14 requires a real `label`, errors associated by `aria-describedby`
 * and marked with `aria-invalid`. Doing that by hand at every call site means
 * getting it wrong eventually, so this component owns the ids and hands the
 * right attributes to whichever control it wraps.
 *
 *   <FormField label="E-mail" error={errors.email} required>
 *     {(props) => <Input type="email" {...props} />}
 *   </FormField>
 *
 * The render-prop shape is deliberate: it makes it impossible to render a
 * control inside a field and forget to spread the wiring.
 *
 * This file holds no validation. Zod schemas live with the action that uses
 * them; a field renders the state it is given (AGENTS.md section 5).
 */

export type FieldControlProps = {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': boolean | undefined;
  'aria-required': boolean | undefined;
  disabled: boolean | undefined;
};

type FieldContextValue = { invalid: boolean };

const FieldContext = createContext<FieldContextValue>({ invalid: false });

export function useFieldInvalid(): boolean {
  return useContext(FieldContext).invalid;
}

export type FormFieldProps = {
  label: ReactNode;
  /** Shown below the control. Explains the field before it is filled in. */
  description?: ReactNode;
  /** Present means invalid. The message replaces the description. */
  error?: string;
  required?: boolean;
  /** Mark as optional instead — used when most of a form is required. */
  optional?: boolean;
  disabled?: boolean;
  className?: string;
  children: (props: FieldControlProps) => ReactNode;
};

export function FormField({
  label,
  description,
  error,
  required = false,
  optional = false,
  disabled = false,
  className,
  children,
}: FormFieldProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const { t } = useDictionary();
  const invalid = Boolean(error);

  // The error replaces the description rather than joining it: two messages
  // read out in sequence is noise at the moment the user needs one instruction.
  const describedBy = invalid ? errorId : description ? descriptionId : undefined;

  return (
    <FieldContext.Provider value={{ invalid }}>
      <div className={cn('flex flex-col gap-2', className)}>
        <Label
          htmlFor={id}
          required={required}
          optional={optional}
          optionalLabel={t.common.optional}
        >
          {label}
        </Label>

        {children({
          id,
          'aria-describedby': describedBy,
          'aria-invalid': invalid || undefined,
          'aria-required': required || undefined,
          disabled: disabled || undefined,
        })}

        {invalid ? (
          <FieldError id={errorId}>{error}</FieldError>
        ) : description ? (
          <HelperText id={descriptionId}>{description}</HelperText>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/**
 * The error message for a field.
 *
 * `role="alert"` so a validation failure that appears after submit is
 * announced rather than only shown (section 14, dynamic content).
 */
export function FieldError({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Text
      id={id}
      role="alert"
      variant="body-sm"
      tone="danger"
      className={cn('flex items-start gap-1.5', className)}
    >
      {children}
    </Text>
  );
}

export function HelperText({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Text id={id} variant="body-sm" tone="subtle" className={className}>
      {children}
    </Text>
  );
}
