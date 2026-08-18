'use client';

/**
 * Per-chain launchpad board with a project drilldown: click a launchpad row
 * to expand its example projects (top tokens by 24h volume) — MC, ATH MC,
 * bonding-curve start MC, 24h volume, Δ24h, and age. Sim mode shows the
 * generated example set; live mode fills the same table from GeckoTerminal
 * pool data. Group headers click through to the chain detail page.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CHAINS, ORDER, fmtUsd, fmtPct, pctCls,
  type ChainCode, type VenueKind, type LaunchpadRow, type TokenCategory,
} from '@voldeck/shared';
import { useLaunchpads, useLaunchpadTokens } from '@/lib/hooks';
import { useQueryState } from '@/lib/useQueryState';
import { OPEN_VENUE_EVENT, PENDING_VENUE_KEY, type OpenVenueDetail } from '@/lib/openVenue';

type KindFilter = 'all' | VenueKind;
type ChainFilter = 'all' | ChainCode;

const KIND_FILTERS: { key: KindFilter; label: string }[] = [
  { key: 'launchpad', label: 'Launchpads' },
  { key: 'dex', label: 'DEX' },
  { key: 'all', label: 'All' },
];
const CHAIN_FILTERS: ChainFilter[] = ['all', ...ORDER];
const KIND_KEYS: KindFilter[] = ['launchpad', 'dex', 'all'];

type CatFilter = 'all' | TokenCategory;

const CAT_META: Record<TokenCategory, { label: string; tag: string; cls: string }> = {
  meme:     { label: 'Meme',     tag: 'MEME',   cls: 'meme' },
  animal:   { label: 'Animal',   tag: 'ANIMAL', cls: 'animal' },
  ai:       { label: 'AI',       tag: 'AI',     cls: 'ai' },
  gaming:   { label: 'Gaming',   tag: 'GAME',   cls: 'game' },
  politifi: { label: 'PolitiFi', tag: 'POLI',   cls: 'poli' },
  utility:  { label: 'Utility',  tag: 'UTIL',   cls: 'util' },
};

const CAT_FILTERS: { key: CatFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...(Object.keys(CAT_META) as TokenCategory[]).map((c) => ({ key: c as CatFilter, label: CAT_META[c].label })),
];

function catTag(cat: TokenCategory | null, onPick?: (c: TokenCategory) => void) {
  if (!cat || !CAT_META[cat]) return null;
  const { tag: label, cls } = CAT_META[cat];
  return (
    <span
      className={'tag ' + cls}
      style={onPick ? { cursor: 'pointer' } : undefined}
      onClick={onPick ? (e) => { e.stopPropagation(); onPick(cat); } : undefined}
      title={onPick ? 'Show only ' + label + ' projects' : undefined}
    >
      {label}
    </span>
  );
}

function SocialLinks({ t }: { t: { website: string | null; twitter: string | null; telegram: string | null } }) {
  const links: [string, string | null][] = [['𝕏', t.twitter], ['TG', t.telegram], ['Web', t.website]];
  const present = links.filter(([, url]) => url);
  if (!present.length) return <span className="sub2">—</span>;
  return (
    <span className="soc">
      {present.map(([label, url]) => (
        <a key={label} href={url!} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          {label}
        </a>
      ))}
    </span>
  );
}

function age(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d >= 1) return d + 'd';
  return Math.max(1, Math.floor(ms / 3_600_000)) + 'h';
}

function TokenTable({ chain, venue }: { chain: ChainCode; venue: string }) {
  const [cat, setCat] = useState<CatFilter>('all');
  const { data } = useLaunchpadTokens(chain, venue, cat === 'all' ? null : cat);
  const emptyMsg = !data
    ? 'Loading…'
    : cat === 'all'
      ? 'No project data yet for this venue'
      : 'No ' + CAT_META[cat].label + ' projects running on this venue right now';
  return (
    <div className="lptoks">
      <div className="lptbar">
        <span className="subt">
          {cat === 'all' ? 'Top projects · 24h vol' : CAT_META[cat].label + ' projects running · 24h vol'}
        </span>
        <span className="sp"></span>
        <div className="seg">
          {CAT_FILTERS.map((f) => (
            <button key={f.key} className={cat === f.key ? 'on' : ''} onClick={() => setCat(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th className="l">Project</th>
            <th>MC</th><th>ATH MC</th><th>Start MC</th>
            <th>Vol 24H</th><th>Δ 24H</th><th>Age</th><th>Socials</th>
          </tr>
        </thead>
        <tbody>
          {data?.tokens.length ? data.tokens.map((t) => (
            <tr key={t.symbol}>
              <td className="l">
                <span className="tnm">{t.name}</span>
                <span className="tk2">{t.symbol}</span>{' '}
                {catTag(t.category, (c) => setCat(c))}
              </td>
              <td className="tnm">{t.mcUsd !== null ? fmtUsd(t.mcUsd) : '—'}</td>
              <td><span className="sub2">{t.athMcUsd !== null ? fmtUsd(t.athMcUsd) : '—'}</span></td>
              <td><span className="sub2">{t.startMcUsd !== null ? fmtUsd(t.startMcUsd) : '—'}</span></td>
              <td className="tnm">{fmtUsd(t.vol24Usd)}</td>
              <td className={'pcell ' + (t.change24 !== null ? pctCls(t.change24) : '')}>
                {t.change24 !== null ? fmtPct(t.change24) : '—'}
              </td>
              <td><span className="sub2">{age(t.launchedAt)}</span></td>
              <td><SocialLinks t={t} /></td>
            </tr>
          )) : (
            <tr><td className="l" colSpan={8}><span className="subt">{emptyMsg}</span></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function Launchpads() {
  const router = useRouter();
  const [kind, setKind] = useQueryState<KindFilter>('lpk', 'launchpad', KIND_KEYS);
  const [chain, setChain] = useQueryState<ChainFilter>('lp', 'all', CHAIN_FILTERS);
  const [open, setOpen] = useState<string | null>(null);
  const [scrollKey, setScrollKey] = useState<string | null>(null);
  const { data } = useLaunchpads();

  /* search hits open a venue's drilldown here (event same-page, storage cross-page) */
  useEffect(() => {
    const openFrom = (d: OpenVenueDetail) => {
      setChain(d.chain);
      setKind('all');
      const key = d.chain + ':' + d.venue;
      setOpen(key);
      setScrollKey(key);
    };
    const onEvt = (e: Event) => openFrom((e as CustomEvent<OpenVenueDetail>).detail);
    window.addEventListener(OPEN_VENUE_EVENT, onEvt);
    try {
      const pending = sessionStorage.getItem(PENDING_VENUE_KEY);
      if (pending) {
        sessionStorage.removeItem(PENDING_VENUE_KEY);
        openFrom(JSON.parse(pending) as OpenVenueDetail);
      }
    } catch { /* ignore malformed handoff */ }
    return () => window.removeEventListener(OPEN_VENUE_EVENT, onEvt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!scrollKey || !data) return;
    const t = setTimeout(() => {
      document.querySelector(`[data-lprkey="${CSS.escape(scrollKey)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setScrollKey(null);
    }, 250);
    return () => clearTimeout(t);
  }, [scrollKey, data]);

  const all = data?.rows ?? [];
  // the chain's real volume, not just the venues we track — so "% of chain"
  // means what it says
  const chainTotal = (ch: ChainCode) =>
    data?.chainVol24?.[ch] ?? all.filter((r) => r.chain === ch).reduce((s, r) => s + r.volumeUsd, 0);

  const groups: { ch: ChainCode; rows: LaunchpadRow[] }[] =
    (chain === 'all' ? ORDER : [chain]).map((ch) => ({
      ch,
      rows: all.filter((r) => r.chain === ch && (kind === 'all' || r.kind === kind)),
    }));

  return (
    <div className="panel">
      <div className="phead">
        <span className="ttl">Launchpads</span>
        <span className="subt">memecoin vol per chain · 24h · click a row for projects</span>
        <span className="sp"></span>
        <div className="seg">
          <button className={chain === 'all' ? 'on' : ''} onClick={() => setChain('all')}>All chains</button>
          {ORDER.map((c) => (
            <button key={c} className={chain === c ? 'on' : ''} onClick={() => setChain(c)}>{c}</button>
          ))}
        </div>
        <div className="seg">
          {KIND_FILTERS.map((f) => (
            <button key={f.key} className={kind === f.key ? 'on' : ''} onClick={() => setKind(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="lpbody">
        {groups.map(({ ch, rows }) => {
          const total = chainTotal(ch);
          const groupSum = rows.reduce((s, r) => s + r.volumeUsd, 0);
          const max = rows[0]?.volumeUsd ?? 1;
          return (
            <div key={ch}>
              <div className="lpg" style={{ cursor: 'pointer' }} onClick={() => router.push('/chain/' + ch)}>
                <span className="dot" style={{ background: CHAINS[ch].color }}></span>
                {CHAINS[ch].name}
                <span className="cs">
                  {rows.length
                    ? fmtUsd(groupSum) + (total > 0 ? ' · ' + ((groupSum / total) * 100).toFixed(0) + '% of chain' : '')
                    : ''}
                </span>
              </div>
              {rows.length ? rows.map((r, i) => {
                const key = ch + ':' + r.venue;
                const isOpen = open === key;
                return (
                  <div key={r.venue}>
                    <div className={'lpr' + (isOpen ? ' open' : '')} data-lprkey={key} onClick={() => setOpen(isOpen ? null : key)}>
                      <span className="rk">#{i + 1}</span>
                      <span className="nm">{r.venue}</span>
                      <span className="bar"><i style={{ width: (r.volumeUsd / max) * 100 + '%', background: CHAINS[ch].color }}></i></span>
                      <span className="pct">{total > 0 ? ((r.volumeUsd / total) * 100).toFixed(0) + '%' : '--'}</span>
                      <span className="val">{fmtUsd(r.volumeUsd)}</span>
                      <span className="cx">›</span>
                    </div>
                    {isOpen && <TokenTable chain={ch} venue={r.venue} />}
                  </div>
                );
              }) : (
                <div className="lpr" style={{ cursor: 'default' }}>
                  <span className="rk"></span>
                  <span className="subt">
                    {kind === 'launchpad' ? 'No launchpad volume tracked' : 'No venue data yet'}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
