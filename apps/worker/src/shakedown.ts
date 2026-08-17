/**
 * Live-source shakedown — run ON THE VPS (needs open internet, no DB writes):
 *   node dist/shakedown.js
 * Fetches one real GeckoTerminal page and one real DexScreener batch per
 * chain and prints what the parsers extract, so both sources can be
 * validated against live responses before trusting a deploy.
 */
import { fetchJson } from './gecko';

const GECKO = process.env.GECKO_BASE || 'https://api.geckoterminal.com/api/v2';
const NETS: [string, string][] = [['SOL', 'solana'], ['ETH', 'eth'], ['BSC', 'bsc']];
const DS: Record<string, string> = { solana: 'solana', eth: 'ethereum', bsc: 'bsc' };

async function main(): Promise<void> {
  for (const [code, net] of NETS) {
    console.log(`\n=== ${code} (${net}) ===`);
    const page = await fetchJson<any>(`${GECKO}/networks/${net}/pools?page=1&sort=h24_volume_usd_desc&include=dex,base_token`);
    const pools = page?.data ?? [];
    if (!pools.length) { console.log('GECKO: NO DATA — check connectivity'); continue; }
    const dexNames = new Map<string, string>(
      (page.included ?? []).filter((i: any) => i.type === 'dex').map((i: any) => [i.id, i.attributes?.name])
    );
    let m5 = 0;
    for (const p of pools) m5 += Number(p.attributes?.volume_usd?.m5 ?? 0) || 0;
    console.log(`GECKO ok: ${pools.length} pools · sum m5 $${Math.round(m5).toLocaleString()}`);
    for (const p of pools.slice(0, 3)) {
      const dex = dexNames.get(p.relationships?.dex?.data?.id) ?? '?';
      console.log(`  ${p.attributes?.name?.padEnd(24)} ${dex.padEnd(14)} m5 $${Math.round(Number(p.attributes?.volume_usd?.m5 ?? 0)).toLocaleString()}`);
    }

    const addrs = pools.slice(0, 10).map((p: any) => String(p.id).slice(String(p.id).indexOf('_') + 1)).join(',');
    const ds = await fetchJson<any>(`https://api.dexscreener.com/latest/dex/pairs/${DS[net]}/${addrs}`);
    const pairs = ds?.pairs ?? [];
    if (!pairs.length) { console.log('DEXSCREENER: NO DATA for those pools'); continue; }
    let dsm5 = 0, withSocials = 0;
    for (const p of pairs) {
      dsm5 += Number(p.volume?.m5 ?? 0) || 0;
      if (p.info?.socials?.length || p.info?.websites?.length) withSocials++;
    }
    console.log(`DEXSCREENER ok: ${pairs.length}/10 pairs answered · sum m5 $${Math.round(dsm5).toLocaleString()} · ${withSocials} with socials`);
    const s = pairs[0];
    console.log(`  sample: ${s.baseToken?.symbol} dexId=${s.dexId} mc=${s.marketCap ?? s.fdv} chg24=${s.priceChange?.h24} created=${s.pairCreatedAt ? new Date(s.pairCreatedAt).toISOString().slice(0, 10) : '?'}`);
  }
  console.log('\nShakedown done — both sources parse. If a section says NO DATA, send this output back.');
}

main().catch((e) => { console.error('shakedown failed:', e); process.exit(1); });
