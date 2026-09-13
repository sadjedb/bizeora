import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Merge class names, resolving Tailwind conflicts in favour of the last value.
 *
 * Every primitive takes a `className` prop and passes it through here, so a
 * caller can adjust spacing or width at a call site without fighting
 * specificity. What a caller must not do is override a colour: the token rules
 * in docs/DESIGN-SYSTEM.md section 2 hold regardless of this escape hatch.
 *
 * ---
 *
 * **Why this is configured rather than used bare.**
 *
 * tailwind-merge decides which classes conflict from a table of Tailwind's own
 * scales. Our type scale is not Tailwind's: `text-body-sm` and `text-overline`
 * are font sizes, but tailwind-merge has never heard of them, and its
 * `text-color` group accepts any unknown value. So it filed every size token as
 * a colour — and since `Text` renders `cn(size, tone)`, the tone silently
 * deleted the size. The whole type scale was collapsing to inherited body text
 * wherever a tone was set, which is invisible in review and was caught only by
 * an axe contrast failure reporting the wrong font size.
 *
 * The same trap applies to `shadow-focus`, which would be read as a shadow
 * colour rather than the focus ring itself.
 *
 * Adding a token to `tokens.css` therefore means adding it here too. That is
 * the cost of a custom scale, and it is cheaper than the bug.
 */

/** Every font-size token in tokens.css, in scale order. */
const FONT_SIZES = [
  'display-2xl',
  'display-xl',
  'display-lg',
  'display-md',
  'heading-lg',
  'heading-md',
  'heading-sm',
  'body-lg',
  'body',
  'body-sm',
  'caption',
  'overline',
  'mono',
  'mono-sm',
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
      shadow: ['shadow-focus'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
