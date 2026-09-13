'use client';

import { Dialog, DropdownMenu, Popover, Tooltip } from 'radix-ui';
import { X } from 'lucide-react';
import { type ComponentPropsWithoutRef, type ReactNode } from 'react';

import { cn } from '@/components/ui/cn';
import { IconButton } from '@/components/ui/button';
import { Heading, Text } from '@/components/ui/typography';

/**
 * Overlay surfaces: Dialog, Sheet, DropdownMenu, Popover, Tooltip.
 *
 * All four are Radix primitives restyled to the tokens, which is what
 * `AGENTS.md` section 12 asks for — the behaviour that is genuinely hard is
 * focus trapping, focus restoration, Escape handling, scroll locking and
 * `aria-*` wiring, and reimplementing it would be a defect factory. Section 8's
 * requirements (trap focus, Escape closes, the trigger regains focus, the
 * background does not scroll) are all satisfied by the primitive.
 *
 * What is ours: the sizes, the radii, the shadows, the motion, and the rule
 * that a destructive confirmation names its object and does not take focus.
 */

const OVERLAY = [
  'fixed inset-0 z-50 bg-overlay',
  'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
  'motion-reduce:animate-none',
];

/* ---------------------------------------------------------------------------
 * Dialog — centred on desktop, bottom sheet on mobile.
 * ------------------------------------------------------------------------ */

export type DialogSize = 'confirm' | 'form';

const DIALOG_SIZES: Record<DialogSize, string> = {
  /** Confirmations: 480px (section 8). */
  confirm: 'sm:max-w-[480px]',
  /** Forms: 720px. */
  form: 'sm:max-w-[720px]',
};

export type ModalProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: string;
  /** Announced with the title. Say what will happen, not just what this is. */
  description?: ReactNode;
  size?: DialogSize;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export function Modal({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  size = 'confirm',
  footer,
  className,
  children,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}

      <Dialog.Portal>
        <Dialog.Overlay className={cn(OVERLAY)} />

        <Dialog.Content
          // Radix warns when a dialog has no Description. Saying so
          // explicitly is both the fix and the truth; when there is one,
          // Radix wires the id itself and this must not override it.
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'bg-surface fixed z-50 flex flex-col shadow-lg',
            // Mobile: a bottom sheet with rounded top corners and its own
            // scroll area, capped at 90vh (section 8).
            'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-lg',
            // Desktop: centred.
            'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-full',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-md',
            DIALOG_SIZES[size],
            'data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-slide-out-bottom',
            'sm:data-[state=open]:animate-dialog-in sm:data-[state=closed]:animate-dialog-out',
            'motion-reduce:animate-none',
            className,
          )}
        >
          {/* The drag handle the mobile sheet is expected to have. */}
          <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
            <div className="bg-border-strong h-1 w-9 rounded-full" />
          </div>

          <div className="flex items-start justify-between gap-4 p-5 pb-3 md:p-6 md:pb-4">
            <div className="flex flex-col gap-1">
              <Dialog.Title asChild>
                <Heading level={2} variant="heading-lg">
                  {title}
                </Heading>
              </Dialog.Title>
              {description && (
                <Dialog.Description asChild>
                  <Text variant="body-sm" tone="muted">
                    {description}
                  </Text>
                </Dialog.Description>
              )}
            </div>

            <Dialog.Close asChild>
              <IconButton label="Fermer" variant="ghost" size="sm">
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            </Dialog.Close>
          </div>

          {children && (
            <div className="flex-1 overflow-y-auto px-5 pb-2 md:px-6">{children}</div>
          )}

          {footer && (
            <div
              className={cn(
                'flex flex-col-reverse gap-2 p-5 md:flex-row md:justify-end md:p-6',
                'pb-[max(1.25rem,env(safe-area-inset-bottom))]',
              )}
            >
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const ModalClose = Dialog.Close;

/* ---------------------------------------------------------------------------
 * Sheet — a side panel. The cart slide-over and the admin mobile nav.
 * ------------------------------------------------------------------------ */

export type SheetSide = 'right' | 'left' | 'bottom';

const SHEET_SIDES: Record<SheetSide, string> = {
  right: 'inset-y-0 right-0 h-full w-full max-w-[420px] border-l',
  left: 'inset-y-0 left-0 h-full w-full max-w-[320px] border-r',
  bottom: 'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-lg border-t',
};

export type SheetProps = Omit<ModalProps, 'size'> & { side?: SheetSide };

export function Sheet({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  side = 'right',
  footer,
  className,
  children,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}

      <Dialog.Portal>
        <Dialog.Overlay className={cn(OVERLAY)} />

        <Dialog.Content
          // Radix warns when a dialog has no Description. Saying so
          // explicitly is both the fix and the truth; when there is one,
          // Radix wires the id itself and this must not override it.
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'bg-surface border-border fixed z-50 flex flex-col shadow-lg',
            SHEET_SIDES[side],
            side === 'right' &&
              'data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right',
            side === 'left' &&
              'data-[state=open]:animate-slide-in-left data-[state=closed]:animate-slide-out-left',
            side === 'bottom' &&
              'data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-slide-out-bottom',
            'motion-reduce:animate-none',
            className,
          )}
        >
          <div className="border-border flex items-start justify-between gap-4 border-b p-5">
            <div className="flex flex-col gap-1">
              <Dialog.Title asChild>
                <Heading level={2} variant="heading-lg">
                  {title}
                </Heading>
              </Dialog.Title>
              {description && (
                <Dialog.Description asChild>
                  <Text variant="body-sm" tone="muted">
                    {description}
                  </Text>
                </Dialog.Description>
              )}
            </div>

            <Dialog.Close asChild>
              <IconButton label="Fermer" variant="ghost" size="sm">
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-5">{children}</div>

          {footer && (
            <div className="border-border flex flex-col gap-2 border-t p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const SheetClose = Dialog.Close;

/* ---------------------------------------------------------------------------
 * DropdownMenu
 * ------------------------------------------------------------------------ */

const MENU_SURFACE = [
  'bg-surface border-border z-50 min-w-44 rounded-md border p-1 shadow-md',
  'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
  'motion-reduce:animate-none',
];

const MENU_ITEM = [
  'text-body text-fg flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2',
  'select-none outline-none',
  'data-highlighted:bg-bg-subtle',
  'data-disabled:pointer-events-none data-disabled:opacity-40',
];

export type MenuItem = {
  label: string;
  onSelect?: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
};

export function Menu({
  trigger,
  items,
  align = 'end',
  className,
}: {
  trigger: ReactNode;
  items: readonly (MenuItem | 'separator')[];
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          className={cn(MENU_SURFACE, className)}
        >
          {items.map((item, index) =>
            item === 'separator' ? (
              <DropdownMenu.Separator
                key={`separator-${index}`}
                className="bg-border my-1 h-px"
              />
            ) : (
              <DropdownMenu.Item
                key={item.label}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn(MENU_ITEM, item.destructive && 'text-status-negative')}
              >
                {item.icon}
                {item.label}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ---------------------------------------------------------------------------
 * Popover
 * ------------------------------------------------------------------------ */

export function PopoverPanel({
  trigger,
  children,
  align = 'center',
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          className={cn(
            'bg-surface border-border z-50 max-w-80 rounded-md border p-4 shadow-md',
            'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
            'motion-reduce:animate-none',
            className,
          )}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ---------------------------------------------------------------------------
 * Tooltip.
 *
 * A tooltip is a hover-only affordance, so it may only ever carry supplementary
 * text — never the sole explanation of a control (section 13). Anything a user
 * must read belongs in the label or in helper text.
 * ------------------------------------------------------------------------ */

export function TooltipProvider(
  props: ComponentPropsWithoutRef<typeof Tooltip.Provider>,
) {
  return <Tooltip.Provider delayDuration={200} {...props} />;
}

export function InfoTooltip({
  trigger,
  content,
  className,
}: {
  trigger: ReactNode;
  content: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{trigger}</Tooltip.Trigger>

      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className={cn(
            'bg-fg text-fg-inverted text-body-sm z-50 max-w-64 rounded-sm px-2 py-1.5',
            'data-[state=delayed-open]:animate-fade-in',
            'motion-reduce:animate-none',
            className,
          )}
        >
          {content}
          <Tooltip.Arrow className="fill-fg" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
