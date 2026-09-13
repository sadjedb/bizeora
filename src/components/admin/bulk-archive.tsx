'use client';

import { createContext, useContext, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { CheckboxControl } from '@/components/ui/input';
import { FilterBar, FilterLink } from '@/components/ui/page-header';
import { MAX_BULK_ARCHIVE, type ArchivableEntity } from '@/domain/admin/archiving';
import { TableCell, TableHeaderCell } from '@/components/ui/table';
import { Text } from '@/components/ui/typography';
import { useDictionary } from '@/i18n/client';
import { useToast } from '@/components/ui/toast';
import {
  archiveSelectionAction,
  type ArchiveActionResult,
} from '@/app/(workshop)/admin/archive-actions';

/**
 * Ticking rows, and putting them away.
 *
 * Every workshop list had the same gap and the same shape: a queue that only
 * ever grew, one row per record, and no way to say "I am done with these".
 * Rather than five copies of a checkbox column, the whole mechanism lives here
 * and a list opts in by wrapping its table — `SelectAllCell` in the header,
 * `SelectCell` in each row, and the bar appears by itself.
 *
 * Three things are worth knowing about it.
 *
 * **The selection is held by id, not by index**, so it survives the
 * `router.refresh()` that follows a write — and it is intersected with the ids
 * currently on screen whenever it is read, so a row that has left the list
 * cannot be sent again by a checkbox nobody can see any more.
 *
 * **The bar is `sticky` at the bottom of the list**, not fixed to the viewport.
 * A fixed bar covers the last row of a table on a laptop, which is the row
 * somebody is most likely to be about to tick.
 *
 * **A row checkbox sits above the row's stretched link.** `TableRowLink` covers
 * the whole row with `after:inset-0` so the row is one click target; anything
 * interactive inside it needs `relative z-10`, or the link swallows the click.
 */

type Selection = {
  archived: boolean;
  ids: readonly string[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Ticks every id in the group, or clears them if they are all ticked. */
  toggleAll: (group: readonly string[]) => void;
  count: number;
};

const SelectionContext = createContext<Selection | null>(null);

function useSelection(): Selection {
  const selection = useContext(SelectionContext);

  if (!selection) {
    throw new Error('A selection cell must be rendered inside <BulkArchive>.');
  }

  return selection;
}

export function BulkArchive({
  entity,
  archived,
  ids,
  children,
}: {
  entity: ArchivableEntity;
  /** Which half this table is showing: the live queue, or the archive. */
  archived: boolean;
  /** Every row id currently rendered, in order. */
  ids: readonly string[];
  children: ReactNode;
}) {
  const { t } = useDictionary();
  const router = useRouter();
  const toast = useToast();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();

  // Only rows still on screen count. Refreshing after an archive leaves the
  // ids of the rows that just left in state; intersecting here means they
  // cannot be sent again, and the bar empties itself.
  const selected = useMemo(() => ids.filter((id) => picked.has(id)), [ids, picked]);

  const selection = useMemo<Selection>(
    () => ({
      archived,
      ids,
      count: selected.length,
      has: (id) => picked.has(id),
      toggle: (id) =>
        setPicked((previous) => {
          const next = new Set(previous);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      toggleAll: (group) =>
        setPicked((previous) => {
          const everything = group.every((id) => previous.has(id));
          const next = new Set(previous);
          for (const id of group) {
            if (everything) next.delete(id);
            else next.add(id);
          }
          return next;
        }),
    }),
    [archived, ids, picked, selected.length],
  );

  function announce(result: ArchiveActionResult) {
    const words = t.adminArchive;

    if (!result.ok) {
      toast({
        tone: 'danger',
        title: words.failed,
        description:
          result.reason === 'FORBIDDEN' || result.reason === 'UNAUTHENTICATED'
            ? words.forbidden
            : result.reason === 'EMPTY'
              ? words.empty
              : result.reason === 'TOO_MANY'
                ? words.tooMany(MAX_BULK_ARCHIVE)
                : words.unknown,
      });
      return;
    }

    // A batch can move nothing and refuse nothing — everything in it was
    // already where it was being sent. Saying so is better than a silent
    // success that reads like a button that did not work.
    toast({
      tone: result.moved === 0 ? 'neutral' : 'success',
      title:
        result.moved === 0
          ? words.nothingMoved
          : result.archived
            ? words.archived(result.moved)
            : words.restored(result.moved),
      description:
        result.refusedPublished > 0
          ? words.refusedPublished(result.refusedPublished)
          : undefined,
    });
  }

  function apply() {
    startTransition(async () => {
      const result = await archiveSelectionAction({
        entity,
        ids: selected,
        archive: !archived,
      });

      announce(result);

      if (result.ok) {
        setPicked(new Set());
        router.refresh();
      }
    });
  }

  return (
    <SelectionContext.Provider value={selection}>
      <div className="relative">
        {children}

        {selected.length > 0 && (
          <div className="sticky bottom-4 z-20 mt-3 flex justify-center">
            <div className="border-border bg-surface flex items-center gap-3 rounded-full border py-2 pr-2 pl-4 shadow-lg">
              <Text variant="body-sm" as="span" className="tabular-nums">
                {t.adminArchive.selected(selected.length)}
              </Text>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPicked(new Set())}
                leadingIcon={<X className="size-4" />}
              >
                {t.adminArchive.clear}
              </Button>

              <Button
                size="sm"
                onClick={apply}
                loading={pending}
                leadingIcon={
                  archived ? (
                    <ArchiveRestore className="size-4" />
                  ) : (
                    <Archive className="size-4" />
                  )
                }
              >
                {archived ? t.adminArchive.restore : t.adminArchive.archive}
              </Button>
            </div>
          </div>
        )}
      </div>
    </SelectionContext.Provider>
  );
}

/**
 * The "everything" checkbox.
 *
 * `ids` scopes it to one group, which is what the request queue needs: that
 * screen is two tables — the workshop's move and the customer's — under one
 * selection, and a header box that swept both would be lying about the table
 * it sits in. Omitting it means every row on the page.
 */
export function SelectAllToggle({ ids }: { ids?: readonly string[] }) {
  const { t } = useDictionary();
  const selection = useSelection();

  const group = ids ?? selection.ids;
  const ticked = group.filter((id) => selection.has(id)).length;
  const all = group.length > 0 && ticked === group.length;

  return (
    <CheckboxControl
      checked={all ? true : ticked > 0 ? 'indeterminate' : false}
      onCheckedChange={() => selection.toggleAll(group)}
      aria-label={t.adminArchive.selectAll}
    />
  );
}

/** `SelectAllToggle` in a table's header row. */
export function SelectAllCell({ ids }: { ids?: readonly string[] }) {
  return (
    <TableHeaderCell className="w-10">
      <SelectAllToggle ids={ids} />
    </TableHeaderCell>
  );
}

/**
 * One row's checkbox.
 *
 * `label` is what the row is called — an order number, a product name — and it
 * is the only thing a screen reader has to tell one checkbox from another, so
 * it is required rather than optional.
 */
export function SelectToggle({ id, label }: { id: string; label: string }) {
  const { t } = useDictionary();
  const selection = useSelection();

  return (
    // `relative z-10` lifts it above `TableRowLink`'s stretched overlay, which
    // would otherwise take the click and navigate instead of ticking the box.
    <span className="relative z-10 inline-flex">
      <CheckboxControl
        checked={selection.has(id)}
        onCheckedChange={() => selection.toggle(id)}
        aria-label={t.adminArchive.selectRow(label)}
      />
    </span>
  );
}

/** `SelectToggle` in a table row. */
export function SelectCell({ id, label }: { id: string; label: string }) {
  const { t } = useDictionary();

  return (
    <TableCell label={t.adminArchive.selectAll} bare className="w-10 max-md:w-auto">
      <SelectToggle id={id} label={label} />
    </TableCell>
  );
}

/**
 * The two halves of a queue, as links.
 *
 * A URL rather than a piece of component state, for the same reason every other
 * filter in the admin is a link: the archive is a place somebody can be sent to
 * and can bookmark, and coming back from it is the browser's back button. It
 * reuses `FilterBar`, so it looks like — and is — one more filter.
 */
export function ArchiveTabs({
  basePath,
  archived,
  count,
  search,
}: {
  /** The list's own address, without a query string. */
  basePath: string;
  archived: boolean;
  /** How many rows are in the archive, for the tab that opens it. */
  count: number;
  /** Query parameters to carry across, so a filter survives the switch. */
  search?: Record<string, string>;
}) {
  const { t } = useDictionary();

  function href(target: boolean): string {
    const params = new URLSearchParams(search);
    if (target) params.set('archived', '1');
    else params.delete('archived');

    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  return (
    <FilterBar label={t.adminArchive.tabArchived}>
      <FilterLink href={href(false)} current={!archived}>
        {t.adminArchive.tabActive}
      </FilterLink>
      <FilterLink href={href(true)} current={archived}>
        {count > 0 ? t.adminArchive.tabArchivedCount(count) : t.adminArchive.tabArchived}
      </FilterLink>
    </FilterBar>
  );
}
