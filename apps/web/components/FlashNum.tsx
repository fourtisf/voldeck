'use client';

import { useEffect, useRef } from 'react';

/**
 * Numeric cell with the prototype's setNum flash: green (fu) on increase,
 * red (fd) on decrease, cleared after 420ms.
 */
export default function FlashNum({
  value, text, className = 'num', id,
}: {
  value: number;
  text: string;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const was = prev.current;
    prev.current = value;
    if (was === null || value === was) return;
    el.classList.remove('fu', 'fd');
    void el.offsetWidth;
    el.classList.add(value > was ? 'fu' : 'fd');
    const t = setTimeout(() => el.classList.remove('fu', 'fd'), 420);
    return () => clearTimeout(t);
  }, [value]);

  return <span ref={ref} className={className} id={id}>{text}</span>;
}
