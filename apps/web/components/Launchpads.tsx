'use client';

/**
 * Per-chain launchpad board with a project drilldown: click a launchpad row
 * to expand its example projects (top tokens by 24h volume) — MC, ATH MC,
 * bonding-curve start MC, 24h volume, Δ24h, and age. Sim mode shows the
 * generated example set; live mode fills the same table from GeckoTerminal
 * pool data. Group headers click through to the chain detail page.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CHAINS, ORDER, fmtUsd, fmtPct, pctCls,
  type ChainCode, type VenueKind, type LaunchpadRow, type TokenCategory,
} from '@voldeck/shared';
import { useLaunchpads, useLaunchpadTokens } from '@/lib/hooks';
import { useQueryState } from '@/lib/useQueryState';

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

const CAT_FILTERS: { key: CatFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'meme', label: 'Meme' },
  { key: 'ai', label: 'AI' },
  { key: 'utility', label: 'Utility' },
];

function catTag(cat: TokenCategory | null, onPick?: (c: TokenCategory) => void) {
  if (!cat) return null;
  const cls = cat === 'ai' ? 'ai' : cat === 'utility' ? 'util' : 'meme';
  const label = cat === 'ai' ? 'AI' : cat === 'utility' ? 'UTIL' : 'MEME';
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
      : 'No ' + (cat === 'ai' ? 'AI' : cat) + ' projects running on this venue right now';
  return (
    <div className="lptoks">
      <div className="lptbar">
        <span className="subt">
          {cat === 'all' ? 'Top projects · 24h vol' : (cat === 'ai' ? 'AI' : cat === 'utility' ? 'Utility' : 'Meme') + ' projects running · 24h vol'}
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
            <th>Vol 24H</th><th>Δ 24H</th><th>Age</th>
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
            </tr>
          )) : (
            <tr><td className="l" colSpan={7}><span className="subt">{emptyMsg}</span></td></tr>
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
  const { data } = useLaunchpads();

  const all = data?.rows ?? [];
  const chainTotal = (ch: ChainCode) =>
    all.filter((r) => r.chain === ch).reduce((s, r) => s + r.volumeUsd, 0);

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
                    <div className={'lpr' + (isOpen ? ' open' : '')} onClick={() => setOpen(isOpen ? null : key)}>
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
