'use client';

import { useSyncExternalStore } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';

import { IconButton } from '@/components/ui/button';
import { Menu } from '@/components/ui/overlay';
import { useDictionary } from '@/i18n/client';

/**
 * Light, dark, or whatever the operating system says.
 *
 * The palette itself is pure CSS: `tokens.css` declares every colour with
 * `light-dark()` and switches on `color-scheme`, so **a visitor who has never
 * touched this control already gets their system preference**, with no
 * JavaScript and no flash. This component exists only for the visitor who
 * wants something other than what their system says.
 *
 * That is why the stored value has three states rather than two. `system` is
 * not "light" — it is "keep following", and a two-state toggle would quietly
 * take that away from the majority of people the first time they pressed it.
 *
 * The choice lives in `localStorage`, not a cookie, on purpose: a cookie would
 * be sent with every request and would force the storefront's static pages to
 * render per-request just to colour them. `ThemeScript` in the root layout
 * reads it before first paint.
 */

export const THEME_STORAGE_KEY = 'stitch-theme';

export type ThemeChoice = 'system' | 'light' | 'dark';

const CHOICES: readonly { value: ThemeChoice; icon: typeof Sun }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

/**
 * The script that runs before the first paint.
 *
 * Without it, a visitor who chose dark on a light system would see the light
 * palette for one frame — the classic flash — because the stylesheet has no way
 * to know about a stored preference. It is deliberately tiny and synchronous:
 * anything that defers to hydration is already too late.
 *
 * It never *writes*. If storage is unavailable — a private window, a browser
 * blocking site data — it does nothing at all and the page falls back to the
 * system preference, which is a correct outcome rather than a broken one.
 */
export function ThemeScript() {
  const script = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

/**
 * Who is watching the document's theme.
 *
 * `useSyncExternalStore` needs somebody to tell it the value moved, and the
 * value lives on `documentElement` rather than in React. A `storage` event
 * covers the same site open in another tab; `apply` covers this one.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readChoice(): ThemeChoice {
  const stamped = document.documentElement.dataset.theme;
  return stamped === 'light' || stamped === 'dark' ? stamped : 'system';
}

/** Apply a choice to the document, and remember it. */
function apply(choice: ThemeChoice): void {
  const root = document.documentElement;

  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;

  try {
    if (choice === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage refused. The document attribute is already set, so the choice
    // holds for this page; it simply will not survive a reload.
  }

  for (const listener of listeners) listener();
}

export function ThemeToggle({
  className,
  onDark = false,
}: {
  className?: string;
  /** Sits on the admin's near-black sidebar rather than on the page. */
  onDark?: boolean;
}) {
  /*
   * The document is the state.
   *
   * `ThemeScript` has already stamped `data-theme` before the first paint, so
   * the choice in force is readable from the element itself — there is nothing
   * to copy into React state and nothing to synchronise in an effect. The
   * server has no document, so its snapshot is `system`, which is what the
   * markup would say anyway; the client reads the real value on hydration.
   */
  const { t } = useDictionary();
  const choice = useSyncExternalStore(subscribe, readChoice, () => 'system');

  const current = CHOICES.find((entry) => entry.value === choice) ?? CHOICES[2]!;
  const Icon = current.icon;
  const label = (value: ThemeChoice): string => t.theme[value];

  return (
    <Menu
      trigger={
        <IconButton
          label={t.theme.current(label(current.value))}
          variant="ghost"
          size="sm"
          className={
            onDark
              ? `text-fg-on-dark-muted hover:bg-surface-inverse hover:text-fg-on-dark ${className ?? ''}`
              : className
          }
        >
          <Icon className="size-5" aria-hidden="true" />
        </IconButton>
      }
      items={CHOICES.map((entry) => {
        const active = entry.value === choice;
        const ItemIcon = active ? Check : entry.icon;

        return {
          label: label(entry.value),
          // A tick on the active one, so the menu says which is in force
          // rather than leaving the trigger's icon to imply it.
          icon: (
            <ItemIcon
              className={active ? 'text-accent size-4' : 'size-4'}
              aria-hidden="true"
            />
          ),
          onSelect: () => apply(entry.value),
        };
      })}
    />
  );
}
