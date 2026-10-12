'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * State kept in this browser's localStorage. Starts from `initial` and loads
 * the saved value after mount, so the server render and first client render
 * match. Storage can be unavailable (private mode, blocked); then it just
 * doesn't persist.
 */
export function useStoredState<T>(key: string, initial: T, isValid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      if (isValid(parsed)) setValue(parsed);
    } catch {
      // Unreadable or unavailable: keep the initial value.
    }
  }, [key, isValid]);

  const save = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not persisted; still works for this visit.
      }
    },
    [key],
  );

  return [value, save] as const;
}
