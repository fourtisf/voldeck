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
  /* --- Robinhood Chain availability probe --------------------------------- */
  console.log('\n=== ROBINHOOD CHAIN PROBE ===');
  const geckoHits: string[] = [];
  for (let p = 1; p <= 12; p++) {
    const page = await fetchJson<any>(`${GECKO}/networks?page=${p}`);
    const nets = page?.data ?? [];
    if (!nets.length) break;
    for (const n of nets) {
      const name = String(n.attributes?.name ?? '');
      if (/robin/i.test(name) || /robin/i.test(String(n.id))) geckoHits.push(`${n.id} (${name})`);
    }
  }
  console.log(geckoHits.length
    ? `GECKO indexes Robinhood: ${geckoHits.join(', ')}\n  → add to /opt/voldeck/.env:  RBH_GECKO_NETWORK=${geckoHits[0].split(' ')[0]}`
    : 'GECKO: Robinhood Chain not indexed yet');
  const dsSearch = await fetchJson<any>(`https://api.dexscreener.com/latest/dex/search?q=robinhood`);
  const dsChains = [...new Set(((dsSearch?.pairs ?? []) as any[]).map((p) => String(p.chainId)).filter((c) => /robin/i.test(c)))];
  console.log(dsChains.length
    ? `DEXSCREENER indexes Robinhood: chainId ${dsChains.join(', ')}\n  → add to /opt/voldeck/.env:  RBH_DS_CHAIN=${dsChains[0]}`
    : 'DEXSCREENER: no robinhood chainId found via search');
  if (geckoHits.length) {
    console.log('After adding the .env line(s):  pm2 restart volread-worker  → RBH flows like the other chains.');
  } else {
    console.log('RBH stays empty until either an aggregator indexes Robinhood Chain or ROBINFUN_DATABASE_URL is provided.');
  }

  console.log('\nShakedown done — send this whole output back if anything says NO DATA.');
}

main().catch((e) => { console.error('shakedown failed:', e); process.exit(1); });
