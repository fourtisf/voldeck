'use client';

/**
 * Global search in the top nav — chains, launchpads/venues, and projects.
 * `/` focuses the box, arrows navigate, Enter opens the highlighted hit,
 * Escape closes (without triggering the detail page's Escape-to-back).
 * Venue and project hits open the venue's drilldown in the Launchpads panel.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CHAINS, fmtUsd, type SearchPayload } from '@voldeck/shared';
import { useSearch } from '@/lib/hooks';
import { requestOpenVenue } from '@/lib/openVenue';

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

interface Hit {
  key: string;
  render: React.ReactNode;
  action: () => void;
}

function buildHits(
  data: SearchPayload | undefined,
  go: (path: string) => void,
  openVenue: (chain: SearchPayload['chains'][number], venue: string) => void
): { hits: Hit[]; sections: { title: string; from: number; to: number }[] } {
  const hits: Hit[] = [];
  const sections: { title: string; from: number; to: number }[] = [];
  if (!data) return { hits, sections };

  if (data.chains.length) {
    const from = hits.length;
    for (const c of data.chains) {
      hits.push({
        key: 'c:' + c,
        action: () => go('/chain/' + c),
        render: (
          <>
            <span className="dot" style={{ background: CHAINS[c].color }}></span>
            <b>{CHAINS[c].name}</b><span className="sub">{c}</span>
            <span className="meta">chain</span>
          </>
        ),
      });
    }
    sections.push({ title: 'Chains', from, to: hits.length });
  }
  if (data.venues.length) {
    const from = hits.length;
    for (const v of data.venues) {
      hits.push({
        key: 'v:' + v.chain + ':' + v.venue,
        action: () => openVenue(v.chain, v.venue),
        render: (
          <>
            <span className="dot" style={{ background: CHAINS[v.chain].color }}></span>
            <b>{v.venue}</b><span className="sub">{v.chain} · {v.kind === 'launchpad' ? 'launchpad' : 'DEX'}</span>
            <span className="meta">{fmtUsd(v.vol24Usd)} 24h</span>
          </>
        ),
      });
    }
    sections.push({ title: 'Launchpads & venues', from, to: hits.length });
  }
  if (data.tokens.length) {
    const from = hits.length;
    for (const t of data.tokens) {
      hits.push({
        key: 't:' + t.chain + ':' + t.venue + ':' + t.symbol,
        action: () => openVenue(t.chain, t.venue),
        render: (
          <>
            <span className="dot" style={{ background: CHAINS[t.chain].color }}></span>
            <b>{t.name}</b><span className="sub">{t.symbol} · {t.venue}</span>
            <span className="meta">{t.mcUsd !== null ? fmtUsd(t.mcUsd) + ' MC' : fmtUsd(t.vol24Usd) + ' 24h'}</span>
          </>
        ),
      });
    }
    sections.push({ title: 'Projects', from, to: hits.length });
  }
  return { hits, sections };
}

export default function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q.trim(), 250);
  const { data } = useSearch(open ? dq : null);

  const { hits, sections } = useMemo(
    () =>
      buildHits(
        dq.length >= 2 ? data : undefined,
        (path) => { setOpen(false); setQ(''); router.push(path); },
        (chain, venue) => {
          setOpen(false); setQ('');
          requestOpenVenue({ chain, venue }, (path) => router.push(path));
        }
      ),
    [data, dq, router]
  );

  useEffect(() => { setIdx(0); }, [dq]);

  /* `/` focuses the search box from anywhere (except while typing) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => (i + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => (i - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter') { e.preventDefault(); hits[Math.min(idx, hits.length - 1)]?.action(); }
  };

  const showDrop = open && dq.length >= 2;

  return (
    <div className="searchwrap">
      <input
        ref={inputRef}
        className="search"
        placeholder="Search…  /"
        value={q}
        spellCheck={false}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {showDrop && (
        <div className="sdrop">
          {sections.length ? sections.map((s) => (
            <div key={s.title}>
              <div className="sh">{s.title}</div>
              {hits.slice(s.from, s.to).map((h, i) => (
                <div
                  key={h.key}
                  className={'srow' + (s.from + i === idx ? ' on' : '')}
                  onMouseDown={(e) => { e.preventDefault(); h.action(); }}
                  onMouseEnter={() => setIdx(s.from + i)}
                >
                  {h.render}
                </div>
              ))}
            </div>
          )) : (
            <div className="sempty">{data ? 'No matches for “' + dq + '”' : 'Searching…'}</div>
          )}
        </div>
      )}
    </div>
  );
}
