import type { BulletTask } from './loop';

/**
 * Bullet case files may give notes as a flat list ("notes", one group) or as
 * groups ("noteGroups"). Older cases use the flat form; new ones group.
 */
export function taskFromFixture(data: Record<string, unknown>): BulletTask {
  const groups = Array.isArray(data.noteGroups)
    ? (data.noteGroups as string[][])
    : Array.isArray(data.notes) && data.notes.length > 0
      ? [data.notes as string[]]
      : [];
  const { notes: _flat, ...rest } = data;
  return { ...(rest as Omit<BulletTask, 'noteGroups'>), noteGroups: groups };
}
