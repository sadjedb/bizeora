'use client';

import { Minus, Plus } from 'lucide-react';
import { useId } from 'react';

import { cn } from '@/components/ui/cn';
import { useDictionary } from '@/i18n/client';

/**
 * QuantitySelector.
 *
 * A 40px stepper around a centred numeric field (section 8). It clamps to the
 * `min`/`max` it is given and reports the result; it does not know stock
 * levels, discount tiers or what a valid order quantity is. Availability is a
 * repository question and tiering is `domain/pricing`.
 *
 * The field is `inputMode="numeric"` rather than `type="number"`: a number
 * input brings spinners that duplicate the buttons, and on some browsers it
 * silently discards non-numeric input mid-edit.
 */

export type QuantitySelectorProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  /** The accessible name. "Quantité" unless the row needs disambiguating. */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
};

export function QuantitySelector({
  value,
  onChange,
  min = 1,
  max = 999,
  disabled = false,
  label,
  size = 'md',
  className,
}: QuantitySelectorProps) {
  const { t } = useDictionary();
  const id = useId();

  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const set = (next: number) => {
    if (!Number.isNaN(next)) onChange(clamp(next));
  };

  const buttonSize = size === 'sm' ? 'size-8' : 'size-10';
  const fieldWidth = size === 'sm' ? 'w-10' : 'w-12';

  const buttonClass = cn(
    buttonSize,
    'flex shrink-0 items-center justify-center',
    'text-fg-muted hover:text-fg hover:bg-bg-subtle',
    'transition-colors duration-fast ease-out',
    'focus-visible:outline-none focus-visible:shadow-focus rounded-sm',
    'disabled:pointer-events-none disabled:opacity-40',
    'motion-reduce:transition-none',
  );

  return (
    <div
      className={cn(
        'border-border bg-surface inline-flex items-center rounded-sm border',
        disabled && 'opacity-40',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => set(value - 1)}
        disabled={disabled || value <= min}
        aria-label={t.cart.decrease}
        aria-controls={id}
        className={buttonClass}
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>

      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        disabled={disabled}
        aria-label={label ?? t.product.quantity}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '');
          if (digits === '') return;
          set(Number.parseInt(digits, 10));
        }}
        // Clamp on blur so a user can clear the field while typing without it
        // snapping back under them on every keystroke.
        onBlur={(event) => {
          const digits = event.target.value.replace(/\D/g, '');
          set(digits === '' ? min : Number.parseInt(digits, 10));
        }}
        className={cn(
          fieldWidth,
          'bg-transparent text-center',
          'text-body text-fg font-medium tabular-nums',
          'border-none focus:outline-none',
          'disabled:cursor-not-allowed',
        )}
      />

      <button
        type="button"
        onClick={() => set(value + 1)}
        disabled={disabled || value >= max}
        aria-label={t.cart.increase}
        aria-controls={id}
        className={buttonClass}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
