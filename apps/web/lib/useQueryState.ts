'use client';

import { useEffect, useState } from 'react';

/**
 * UI state persisted in the URL query string so chart views are shareable
 * (?range=7d&view=bubble…). Reads the param after mount (avoids SSR
 * hydration mismatch), writes via history.replaceState — no navigation, no
 * scroll. Defaults are omitted from the URL to keep links clean.
 */
export function useQueryState<T extends string>(
  key: string,
  def: T,
  valid: readonly T[]
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(def);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get(key);
    if (q && (valid as readonly string[]).includes(q)) setValue(q as T);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (v: T) => {
    setValue(v);
    const p = new URLSearchParams(window.location.search);
    if (v === def) p.delete(key);
    else p.set(key, v);
    const qs = p.toString();
    history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
  };

  return [value, set];
}
