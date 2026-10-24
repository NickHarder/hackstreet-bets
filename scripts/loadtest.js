// Load test: simulates N open browser tabs and a steady stream of bets, the way
// the real client behaves (each tab refreshes once, jittered, after every bet).
//
//   npm run loadtest                    # 30 and 60 tabs at 0.5, 1 and 2 bets/sec
//   npm run loadtest -- --tabs 80 --rates 1,3 --seconds 20
//
// It starts its own server on a free port with a throwaway data folder, so it
// never touches your real data.
import fs from 'node:fs';
import { startServer } from '../test/helpers.js';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const TABS = arg('tabs', '30,60').split(',').map(Number);
const RATES = arg('rates', '0.5,1,2').split(',').map(Number);
const SECONDS = Number(arg('seconds', 15));
const HISTORY = Number(arg('history', 1500));

const server = await startServer();
const B = server.url;
const post = (p, body, cookie) => fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie || '' }, body: JSON.stringify(body) });
const procStat = `/proc/${server.child.pid}/stat`;
const cpuSeconds = () => { if (!fs.existsSync(procStat)) return null; const f = fs.readFileSync(procStat, 'utf8').split(') ')[1].split(' '); return (Number(f[11]) + Number(f[12])) / 100; };
const pct = (a, q) => (a.length ? Math.round(a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) * q)]) : NaN);

const maxTabs = Math.max(...TABS);
const cookies = [];
for (let i = 0; i < maxTabs; i++) { const r = await post('/api/auth', { name: `load${i}`, pin: '1234' }); cookies.push(r.headers.get('set-cookie').split(';')[0]); }
const markets = (await (await fetch(B + '/api/markets')).json()).markets;
const bet = (k, amount) => { const m = markets[k % markets.length]; const o = m.outcomes[k % m.outcomes.length]; return post(`/api/markets/${m.id}/trade`, { outcomeId: o.id, side: 'buy', amount }, cookies[k % cookies.length]).then((r) => r.arrayBuffer()); };

process.stdout.write(`Seeding ${HISTORY} past bets so the leaderboard has realistic history... `);
for (let k = 0; k < HISTORY; k++) await bet(k, 3);
console.log('done.\n');

function openTabs(n) {
  const refresh = [];
  const tabs = cookies.slice(0, n).map((cookie) => {
    const ac = new AbortController(); let timer = null; let busy = false; let again = false;
    const schedule = () => {
      if (busy) { again = true; return; }
      if (timer) return;
      timer = setTimeout(async () => {
        timer = null; busy = true; const s = performance.now();
        try { await fetch(B + '/api/live', { headers: { cookie } }).then((r) => r.arrayBuffer()); refresh.push(performance.now() - s); } catch { /* aborted */ }
        busy = false; if (again) { again = false; schedule(); }
      }, 300 + Math.random() * 500);
    };
    fetch(B + '/api/stream', { signal: ac.signal }).then(async (r) => {
      const rd = r.body.getReader(); const dec = new TextDecoder();
      for (;;) { const { value, done } = await rd.read(); if (done) break; if (/"type":"(trade|leaderboard|feed)"/.test(dec.decode(value))) schedule(); }
    }).catch(() => {});
    return ac;
  });
  return { refresh, close: () => tabs.forEach((t) => t.abort()) };
}

const rows = [];
for (const n of TABS) {
  const tabs = openTabs(n);
  await new Promise((r) => setTimeout(r, 500));
  for (const rate of RATES) {
    tabs.refresh.length = 0;
    const lat = []; const c0 = cpuSeconds(); const t0 = Date.now(); const count = Math.max(1, Math.round(SECONDS * rate));
    for (let k = 0; k < count; k++) {
      const s = performance.now(); await bet(HISTORY + k, 1); lat.push(performance.now() - s);
      const wait = t0 + (k + 1) * (1000 / rate) - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    await new Promise((r) => setTimeout(r, 1000));
    const c1 = cpuSeconds(); const wall = (Date.now() - t0) / 1000;
    rows.push({ tabs: n, 'bets/sec': rate, 'server CPU': c0 === null ? 'n/a' : `${Math.round((100 * (c1 - c0)) / wall)}%`, 'bet p95 (ms)': pct(lat, 0.95), 'screen refresh p50 (ms)': pct(tabs.refresh, 0.5), 'screen refresh p95 (ms)': pct(tabs.refresh, 0.95) });
  }
  tabs.close();
}
console.table(rows);
console.log('Screen refresh is the time for one refresh request. Each tab first waits a deliberate 300-800ms so tabs do not all ask at once.');
await server.stop();
process.exit(0);
