'use client';

import { useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil } from 'lucide-react';

import { Alert, Badge } from '@/components/ui/feedback';
import { Button, IconButton } from '@/components/ui/button';
import { Inline, Stack } from '@/components/layout/layout';
import { Text } from '@/components/ui/typography';
import type { HomepageSectionType } from '@/domain/content';
import { useDictionary } from '@/i18n/client';
import type { Dictionary } from '@/i18n';

import { moveSectionAction, toggleSectionAction } from './actions';
import { SectionEditor, type EditableSection } from './section-editor';

/**
 * The bands, in the order a visitor meets them.
 *
 * A list rather than a canvas: the page is a vertical stack of designed bands,
 * so the editor is a vertical stack of rows. Each row does the three things
 * that are done often — move it, switch it off, change its words — and opens a
 * dialog for the rest.
 *
 * Every action is a round trip that revalidates the page, so what is on screen
 * is what a visitor would get. On a screen that edits the front page, an
 * optimistic update that turns out to be wrong is worse than a half-second of
 * waiting.
 */

/**
 * What each band is called, in the reader's language.
 *
 * A function rather than a constant, for the same reason the navigation's is:
 * a module-level object would be built once, in whichever language the server
 * happened to start in.
 */
function sectionNames(t: Dictionary): Record<HomepageSectionType, string> {
  return {
    BANNER: t.admin.bandBanner,
    HERO: t.admin.bandHero,
    MARQUEE: t.admin.bandMarquee,
    HOW_IT_WORKS: t.admin.bandHowItWorks,
    CATEGORY_GRID: t.admin.bandCategories,
    FEATURED_PRODUCTS: t.admin.bandFeatured,
    GALLERY: t.admin.bandGallery,
    WHY_US: t.admin.bandWhyUs,
    REVIEWS: t.admin.bandReviews,
    SOCIAL: t.admin.bandSocial,
    CUSTOM_CTA: t.admin.bandCustomCta,
    FINAL_CTA: t.admin.bandFinalCta,
  };
}

export function SectionList({ sections }: { sections: readonly EditableSection[] }) {
  const { t } = useDictionary();
  const names = sectionNames(t);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditableSection | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok && result.message) setError(result.message);
    });
  }

  return (
    <Stack gap={3}>
      {error && (
        <Alert tone="danger" title={t.admin.changeRefused}>
          {error}
        </Alert>
      )}

      <ul className="flex list-none flex-col gap-2 p-0">
        {sections.map((section, index) => (
          <li
            key={section.id}
            className="border-border bg-surface flex flex-wrap items-center gap-3 rounded-md border p-3"
          >
            <Inline gap={1} className="items-center">
              <IconButton
                label={t.admin.moveUp}
                variant="ghost"
                size="sm"
                disabled={index === 0 || pending}
                onClick={() =>
                  run(() => moveSectionAction({ sectionId: section.id, direction: 'up' }))
                }
              >
                <ArrowUp className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                label={t.admin.moveDown}
                variant="ghost"
                size="sm"
                disabled={index === sections.length - 1 || pending}
                onClick={() =>
                  run(() =>
                    moveSectionAction({ sectionId: section.id, direction: 'down' }),
                  )
                }
              >
                <ArrowDown className="size-4" aria-hidden="true" />
              </IconButton>
            </Inline>

            <div className="flex min-w-0 flex-1 flex-col">
              <Inline gap={2} wrap className="items-center">
                <Text variant="body" as="span" className="font-medium">
                  {names[section.type]}
                </Text>
                {!section.isEnabled && <Badge variant="muted">{t.admin.hidden}</Badge>}
              </Inline>
              <Text variant="caption" tone="subtle" clamp={1}>
                {section.title ?? '—'}
              </Text>
            </div>

            <Inline gap={2} className="items-center">
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                leadingIcon={
                  section.isEnabled ? (
                    <EyeOff aria-hidden="true" />
                  ) : (
                    <Eye aria-hidden="true" />
                  )
                }
                onClick={() =>
                  run(() =>
                    toggleSectionAction({
                      sectionId: section.id,
                      isEnabled: !section.isEnabled,
                    }),
                  )
                }
              >
                {section.isEnabled ? t.admin.hide : t.admin.show}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                disabled={pending}
                leadingIcon={<Pencil aria-hidden="true" />}
                onClick={() => setEditing(section)}
              >
                {t.admin.edit}
              </Button>
            </Inline>
          </li>
        ))}
      </ul>

      {editing && (
        <SectionEditor
          section={editing}
          name={names[editing.type]}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}
