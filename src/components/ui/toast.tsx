'use client';

import { Toast } from 'radix-ui';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { cn } from '@/components/ui/cn';
import { IconButton } from '@/components/ui/button';
import { Text } from '@/components/ui/typography';

/**
 * Toasts.
 *
 * Section 8's rules, implemented rather than described:
 *
 *   - Bottom-right on desktop, top on mobile and clear of the notch.
 *   - At most three at a time; the oldest is dropped when a fourth arrives.
 *   - 4s by default, 8s when an action is offered, and **never auto-dismissed
 *     for a danger toast**, because a decision the user has not seen is not a
 *     decision.
 *   - Announced politely, except errors, which are assertive (section 14).
 *
 * And the rule that governs when to use one at all: a toast never carries
 * information available nowhere else. It confirms; it does not inform.
 */

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export type ToastOptions = {
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
};

type ToastRecord = ToastOptions & { id: number };

const MAX_VISIBLE = 3;

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

/**
 * `toast({ title })` from any client component below the provider.
 * Throws rather than no-oping if the provider is missing: a confirmation that
 * silently fails to appear is worse than a crash in development.
 */
export function useToast(): (options: ToastOptions) => void {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>.');
  }
  return context;
}

const TONE_ICONS = {
  neutral: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

const TONE_ICON_COLOR = {
  neutral: 'text-fg-subtle',
  success: 'text-status-positive',
  warning: 'text-status-attention',
  danger: 'text-status-negative',
} as const;

function durationFor(record: ToastRecord): number | undefined {
  if (record.tone === 'danger') return Infinity;
  return record.action ? 8000 : 4000;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const push = useCallback((options: ToastOptions) => {
    setToasts((current) => {
      const next = [...current, { ...options, id: Date.now() + Math.random() }];
      return next.slice(-MAX_VISIBLE);
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      <Toast.Provider swipeDirection="right">
        {children}

        {toasts.map((record) => {
          const tone = record.tone ?? 'neutral';
          const Icon = TONE_ICONS[tone];

          return (
            <Toast.Root
              key={record.id}
              duration={durationFor(record)}
              type={tone === 'danger' ? 'foreground' : 'background'}
              onOpenChange={(open) => {
                if (!open) dismiss(record.id);
              }}
              className={cn(
                'bg-surface border-border flex items-start gap-3 rounded-md border p-4 shadow-md',
                'data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out',
                'motion-reduce:animate-none',
              )}
            >
              <Icon
                className={cn('mt-0.5 size-5 shrink-0', TONE_ICON_COLOR[tone])}
                aria-hidden="true"
              />

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Toast.Title asChild>
                  <Text variant="heading-sm" as="p">
                    {record.title}
                  </Text>
                </Toast.Title>

                {record.description && (
                  <Toast.Description asChild>
                    <Text variant="body-sm" tone="muted">
                      {record.description}
                    </Text>
                  </Toast.Description>
                )}
              </div>

              {record.action && (
                <Toast.Action altText={record.action.label} asChild>
                  <button
                    type="button"
                    onClick={record.action.onClick}
                    className={cn(
                      'text-body-sm text-accent shrink-0 self-center rounded-sm font-medium',
                      'underline-offset-4 hover:underline',
                      'focus-visible:outline-none focus-visible:shadow-focus',
                    )}
                  >
                    {record.action.label}
                  </button>
                </Toast.Action>
              )}

              <Toast.Close asChild>
                <IconButton
                  label="Fermer"
                  variant="ghost"
                  size="sm"
                  className="-mr-1 -mt-1"
                >
                  <X className="size-4" aria-hidden="true" />
                </IconButton>
              </Toast.Close>
            </Toast.Root>
          );
        })}

        <Toast.Viewport
          className={cn(
            'fixed z-100 flex w-full max-w-96 flex-col gap-2 outline-none',
            // Mobile: top, below the header and clear of the notch.
            'inset-x-0 top-0 p-4 pt-[max(1rem,env(safe-area-inset-top))]',
            // Desktop: bottom-right.
            'sm:inset-x-auto sm:top-auto sm:right-0 sm:bottom-0 sm:p-6',
          )}
        />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}
