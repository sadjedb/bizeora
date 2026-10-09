'use client';

import { Checkbox, Label, RadioGroup, Select, Switch } from 'radix-ui';
import { Check, ChevronDown, Minus } from 'lucide-react';
import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '@/components/ui/cn';
import { useFieldInvalid } from '@/components/ui/field';

/**
 * Form controls.
 *
 * Sizes, radii and states come from `DESIGN-SYSTEM.md` section 8. Two details
 * that look arbitrary and are not:
 *
 *   - **16px text on mobile.** Below 16px, iOS Safari zooms the viewport when a
 *     field takes focus, and the user is left scrolled sideways. Section 13.
 *   - **44px minimum height, 48px on mobile.** Section 13's touch target rule.
 *
 * Every control reads `useFieldInvalid()` so the error border appears from the
 * `FormField` wrapper without the caller passing a second prop that could
 * disagree with `aria-invalid`.
 */

const CONTROL_BASE = [
  'w-full bg-surface text-fg',
  'border border-border rounded-sm',
  'font-sans text-base md:text-body',
  'placeholder:text-fg-subtle',
  'transition-[border-color,box-shadow] duration-fast ease-out',
  'focus-visible:outline-none focus-visible:border-fg focus-visible:shadow-focus',
  'disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-bg-subtle',
  'motion-reduce:transition-none',
];

const INVALID = 'border-status-negative';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  const invalid = useFieldInvalid();

  return (
    <input
      ref={ref}
      className={cn(
        CONTROL_BASE,
        'h-12 px-3 md:h-11',
        (invalid || props['aria-invalid']) && INVALID,
        className,
      )}
      {...props}
    />
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 4, ...props },
  ref,
) {
  const invalid = useFieldInvalid();

  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        CONTROL_BASE,
        'resize-y px-3 py-2.5',
        (invalid || props['aria-invalid']) && INVALID,
        className,
      )}
      {...props}
    />
  );
});

/* ---------------------------------------------------------------------------
 * Select — Radix rather than a native element, so the menu can be styled to
 * the token system on every platform. Keyboard behaviour and typeahead come
 * from the primitive.
 * ------------------------------------------------------------------------ */

/**
 * A native `<select>`, styled to match `Input`.
 *
 * `SelectField` below is the richer Radix control and is what a storefront
 * form uses. This exists for the one case Radix cannot serve: a select whose
 * empty option is meaningful. Radix refuses an item with an empty value — it
 * reserves that for "nothing is selected" — so a field that genuinely means
 * "no value for this option" has nowhere to put it.
 *
 * It also submits with no JavaScript at all, which is why the admin's variant
 * form uses it.
 */
export type NativeSelectProps = ComponentPropsWithoutRef<'select'>;

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  function NativeSelect({ className, children, ...props }, ref) {
    const invalid = useFieldInvalid();

    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            CONTROL_BASE,
            'h-12 appearance-none px-3 pr-9 md:h-11',
            (invalid || props['aria-invalid']) && INVALID,
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="text-fg-subtle pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
      </div>
    );
  },
);

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectFieldProps = {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /**
   * Submits with the form.
   *
   * Radix renders a hidden native select when `Select.Root` is given a name,
   * which is what lets this control live inside a plain `<form action={...}>`.
   * Without it the trigger is a button and the field posts nothing — a silent
   * failure that looks like a working form. Phase 14.5 added it because the
   * admin's product form is a server action over `FormData`.
   */
  name?: string;
  required?: boolean;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
};

export function SelectField({
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  required,
  placeholder = 'Choisir…',
  id,
  disabled,
  className,
  ...aria
}: SelectFieldProps) {
  const invalid = useFieldInvalid();

  return (
    <Select.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      name={name}
      required={required}
      disabled={disabled}
    >
      <Select.Trigger
        id={id}
        className={cn(
          CONTROL_BASE,
          'flex h-12 items-center justify-between gap-2 px-3 text-left md:h-11',
          'data-[placeholder]:text-fg-subtle',
          (invalid || aria['aria-invalid']) && INVALID,
          className,
        )}
        {...aria}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <ChevronDown className="text-fg-subtle size-4" aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className={cn(
            'bg-surface border-border rounded-md border shadow-md',
            'z-50 max-h-72 min-w-(--radix-select-trigger-width) overflow-hidden',
          )}
        >
          <Select.Viewport className="p-1">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'text-body text-fg relative flex cursor-pointer items-center gap-2',
                  'rounded-sm px-2 py-2 pr-8 select-none',
                  'data-highlighted:bg-bg-subtle data-highlighted:outline-none',
                  'data-disabled:pointer-events-none data-disabled:opacity-40',
                )}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="absolute right-2">
                  <Check className="text-accent size-4" aria-hidden="true" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

/* ---------------------------------------------------------------------------
 * Checkbox, Radio, Switch.
 *
 * Each renders its own label so the control and its text are one hit target —
 * a 16px checkbox alone fails the 44px touch rule (section 13).
 * ------------------------------------------------------------------------ */

const CHOICE_BOX = [
  'peer size-5 shrink-0 flex items-center justify-center',
  'border border-border-strong bg-surface',
  'transition-colors duration-fast ease-out',
  'focus-visible:outline-none focus-visible:shadow-focus',
  'data-[state=checked]:bg-fg data-[state=checked]:border-fg',
  'data-[state=indeterminate]:bg-fg data-[state=indeterminate]:border-fg',
  'disabled:cursor-not-allowed disabled:opacity-40',
  'motion-reduce:transition-none',
];

export type CheckboxFieldProps = Omit<
  ComponentPropsWithoutRef<typeof Checkbox.Root>,
  'children'
> & {
  label: ReactNode;
  description?: ReactNode;
};

export function CheckboxField({
  label,
  description,
  className,
  id,
  ...props
}: CheckboxFieldProps) {
  /*
   * A Radix checkbox is a `<button role="checkbox">`, not an `<input>`, and
   * that changes how it is named. `<label for>` only labels form-associated
   * elements, so the plain label this used to render gave the control **no
   * accessible name at all** — it announced as "checkbox" and could not be
   * found by name by a screen reader or by a test. `Label` from Radix forwards
   * its clicks to the control, and `aria-labelledby` is what actually names it.
   */
  const generated = useId();
  const controlId = id ?? `${generated}-control`;
  const labelId = `${generated}-label`;
  const descriptionId = `${generated}-description`;

  return (
    <div className={cn('flex min-h-11 items-start gap-3 py-1.5', className)}>
      <Checkbox.Root
        id={controlId}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(CHOICE_BOX, 'rounded-sm')}
        {...props}
      >
        <Checkbox.Indicator className="text-fg-inverted">
          {props.checked === 'indeterminate' ? (
            <Minus className="size-3.5" aria-hidden="true" />
          ) : (
            <Check className="size-3.5" aria-hidden="true" />
          )}
        </Checkbox.Indicator>
      </Checkbox.Root>

      <div className="flex flex-col gap-0.5">
        <Label.Root
          id={labelId}
          htmlFor={controlId}
          className="text-body text-fg cursor-pointer"
        >
          {label}
        </Label.Root>
        {description && (
          <span id={descriptionId} className="text-body-sm text-fg-subtle">
            {description}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A checkbox with no text beside it.
 *
 * The exception to the rule above, for the one place it does not hold: a
 * selection column in a table, where the row *is* the label and repeating it
 * next to the box would print every order number twice. It is named for a
 * screen reader instead (`aria-label`), and the 44px target comes from the
 * padding of the cell it sits in rather than from a label it must not have.
 */
export function CheckboxControl({
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Checkbox.Root>, 'children'>) {
  return (
    <Checkbox.Root className={cn(CHOICE_BOX, 'rounded-sm', className)} {...props}>
      <Checkbox.Indicator className="text-fg-inverted">
        {props.checked === 'indeterminate' ? (
          <Minus className="size-3.5" aria-hidden="true" />
        ) : (
          <Check className="size-3.5" aria-hidden="true" />
        )}
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}

export type RadioOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export type RadioFieldProps = Omit<
  ComponentPropsWithoutRef<typeof RadioGroup.Root>,
  'children'
> & {
  options: readonly RadioOption[];
};

export function RadioField({ options, className, ...props }: RadioFieldProps) {
  return (
    <RadioGroup.Root className={cn('flex flex-col gap-1', className)} {...props}>
      {options.map((option) => {
        const itemId = `${props.name ?? 'radio'}-${option.value}`;

        return (
          <div key={option.value} className="flex min-h-11 items-start gap-3 py-1.5">
            <RadioGroup.Item
              id={itemId}
              value={option.value}
              disabled={option.disabled}
              className={cn(CHOICE_BOX, 'rounded-full')}
            >
              <RadioGroup.Indicator className="bg-fg-inverted size-2 rounded-full" />
            </RadioGroup.Item>

            <div className="flex flex-col gap-0.5">
              <label htmlFor={itemId} className="text-body text-fg cursor-pointer">
                {option.label}
              </label>
              {option.description && (
                <span className="text-body-sm text-fg-subtle">{option.description}</span>
              )}
            </div>
          </div>
        );
      })}
    </RadioGroup.Root>
  );
}

export type SwitchFieldProps = Omit<
  ComponentPropsWithoutRef<typeof Switch.Root>,
  'children'
> & {
  label: ReactNode;
  description?: ReactNode;
};

export function SwitchField({
  label,
  description,
  className,
  id,
  ...props
}: SwitchFieldProps) {
  return (
    <div className={cn('flex min-h-11 items-center justify-between gap-4', className)}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-body text-fg cursor-pointer">
          {label}
        </label>
        {description && (
          <span className="text-body-sm text-fg-subtle">{description}</span>
        )}
      </div>

      <Switch.Root
        id={id}
        className={cn(
          'border-border-strong bg-track relative h-6 w-11 shrink-0 rounded-full border',
          'transition-colors duration-fast ease-out',
          'focus-visible:outline-none focus-visible:shadow-focus',
          'data-[state=checked]:bg-fg data-[state=checked]:border-fg',
          'disabled:cursor-not-allowed disabled:opacity-40',
          'motion-reduce:transition-none',
        )}
        {...props}
      >
        <Switch.Thumb
          className={cn(
            'bg-surface block size-4.5 rounded-full shadow-sm',
            'transition-transform duration-fast ease-out',
            'translate-x-0.5 data-[state=checked]:translate-x-5.5',
            'motion-reduce:transition-none',
          )}
        />
      </Switch.Root>
    </div>
  );
}
