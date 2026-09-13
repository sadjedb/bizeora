import 'server-only';

import { prisma } from '@/lib/db/client';
import { EDITABLE_SETTINGS, type SettingGroup } from '@/domain/settings';

/**
 * Reading and writing the settings an owner may change.
 *
 * Separate from `settings-repository`, which is the **read** path every feature
 * uses to price something — the same split as `catalogue-repository` and
 * `catalogue-admin-repository`. That module throws when a setting is missing,
 * because a silent default would quote a number the business never agreed to.
 * This one lists rows for a form and writes what the form sends back, and the
 * two have no reason to share a query.
 */

export type AdminSettingRow = {
  key: string;
  value: string;
  group: SettingGroup;
  /** The seed's own English label, shown only when a dictionary has none. */
  label: string | null;
  description: string | null;
  updatedAt: Date;
  /** Who last changed it, for the line under the field. */
  updatedBy: string | null;
};

/**
 * Every editable setting, in the order the screen renders them.
 *
 * Ordered by `EDITABLE_SETTINGS` rather than by the database, because that list
 * is a conversation — what the shop is called, whether it is open, how accounts
 * behave, who gets told, what it charges — and `ORDER BY key` would scatter it
 * alphabetically.
 *
 * A row the catalogue names but the database lacks is **skipped rather than
 * invented**: an absent setting is a seed that has not been run, and rendering
 * an empty field for it would invite somebody to save a value into a row that
 * nothing reads.
 */
export async function listEditableSettings(): Promise<readonly AdminSettingRow[]> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: EDITABLE_SETTINGS.map((setting) => setting.key) } },
    select: {
      key: true,
      value: true,
      label: true,
      description: true,
      updatedAt: true,
      updatedBy: { select: { name: true, email: true } },
    },
  });

  const byKey = new Map(rows.map((row) => [row.key, row]));

  return EDITABLE_SETTINGS.flatMap((setting) => {
    const row = byKey.get(setting.key);
    if (!row) return [];

    return [
      {
        key: row.key,
        value: row.value,
        group: setting.group,
        label: row.label,
        description: row.description,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy?.name ?? row.updatedBy?.email ?? null,
      },
    ];
  });
}

/**
 * Write the ones that actually changed.
 *
 * One transaction, and **only the differences**: a settings form posts every
 * field it rendered, and writing all twelve every time would stamp the owner's
 * name and the current time onto rows nobody touched. "Who changed the deposit
 * percentage, and when" is the question this table exists to answer.
 */
export async function saveSettings(input: {
  values: Readonly<Record<string, string>>;
  actorUserId: string;
}): Promise<{ changed: readonly string[] }> {
  const keys = Object.keys(input.values);
  if (keys.length === 0) return { changed: [] };

  const current = await prisma.setting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });

  const changed = current
    .filter((row) => input.values[row.key] !== row.value)
    .map((row) => row.key);

  if (changed.length === 0) return { changed: [] };

  await prisma.$transaction(
    changed.map((key) =>
      prisma.setting.update({
        where: { key },
        data: { value: input.values[key]!, updatedByUserId: input.actorUserId },
      }),
    ),
  );

  return { changed };
}
