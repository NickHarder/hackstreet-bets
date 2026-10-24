import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadDb, persist as persistToDisk, persistNow as persistToDiskNow, emptyDb, flushOnExit, DB_FILE } from './store.js';
import { lmsrPrices, lmsrTradeCost, lmsrSharesForCost } from './market.js';
import { PALETTE, starterPack, demoPack } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'hackadmin';
const DEMO = !!process.env.DEMO;

let db = loadDb();

// ---------------------------------------------------------------- caching
// Every change to the data goes through persist()/persistNow(), which bumps
// `version`. Derived data (position indexes, leaderboard, feed) is rebuilt at
// most once per version instead of once per request. This matters because each
// bet makes every open browser tab ask for a fresh leaderboard.
let version = 0;
const invalidate = () => { version++; };
function persist(d) { invalidate(); persistToDisk(d); }
function persistNow(d) { invalidate(); persistToDiskNow(d); }
function cached(fn) {
  const store = new Map();
  let at = -1;
  return (key = '') => {
    if (at !== version) { store.clear(); at = version; }
    if (!store.has(key)) store.set(key, fn(key));
    return store.get(key);
  };
}

// ---------------------------------------------------------------- helpers
const now = () => Date.now();
const uid = () => crypto.randomBytes(6).toString('base64url');
const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
function colorForName(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % 8];
}

// ---------------------------------------------------------------- SSE
const clients = new Set();
function broadcast(evt) {
  const data = `data: ${JSON.stringify(evt)}\n\n`;
  for (const res of clients) { try { res.write(data); } catch { clients.delete(res); } }
}
setInterval(() => { for (const res of clients) { try { res.write(': ping\n\n'); } catch { clients.delete(res); } } }, 25000);

// ---------------------------------------------------------------- users
function currentUser(req) {
  const sid = parseCookies(req).sid;
  const id = sid && db.sessions[sid];
  return id ? db.users[id] || null : null;
}
const publicUser = (u) => (u ? { id: u.id, name: u.name, color: u.color, isAdmin: !!u.isAdmin, bot: !!u.bot } : null);

function createUser(name, pin, opts = {}) {
  name = String(name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 20) fail(400, 'Name must be 2-20 characters');
  if (!/^[\p{L}\p{N} ._'\-]+$/u.test(name)) fail(400, "Names can use letters, numbers, spaces and . _ - '");
  if (Object.values(db.users).some((u) => u.name.toLowerCase() === name.toLowerCase())) fail(409, 'That name is taken');
  pin = String(pin || '');
  if (pin.length < 4) fail(400, 'PIN must be at least 4 characters');
  const salt = crypto.randomBytes(8).toString('hex');
  const u = {
    id: uid(), name, color: colorForName(name), salt, pinHash: hashPin(pin, salt),
    balance: db.settings.startingBalance, deposited: db.settings.startingBalance,
    createdAt: opts.t || now(), isAdmin: false, bot: !!opts.bot,
    tradeCount: 0, realizedPnl: 0, biggestWin: 0, wins: 0,
  };
  db.users[u.id] = u;
  return u;
}

// ---------------------------------------------------------------- markets
const effStatus = (m) => (m.status === 'open' && m.closesAt && now() > m.closesAt ? 'closed' : m.status);
const qsOf = (m) => m.outcomes.map((o) => o.q);

function pushHistory(m, t, prices) {
  m.history.push({ t, p: prices.map((p) => +p.toFixed(4)) });
  if (m.history.length > 700) {
    const keep = m.history.slice(-250);
    const older = m.history.slice(0, -250).filter((_, i) => i % 2 === 0);
    m.history = older.concat(keep);
  }
}

function normalizeOutcomes(input) {
  let names = [];
  if (Array.isArray(input.outcomes)) names = input.outcomes.map((s) => String(typeof s === 'object' ? s.name : s).trim()).filter(Boolean);
  if (input.type === 'binary' || names.length === 0) names = ['Yes', 'No'];
  if (names.length < 2 || names.length > 12) fail(400, 'A market needs between 2 and 12 outcomes');
  const lower = names.map((n) => n.toLowerCase());
  if (new Set(lower).size !== lower.length) fail(400, 'Outcomes must be unique');
  return names.map((n) => n.slice(0, 60));
}

function createMarket(input, opts = {}) {
  const title = String(input.title || '').trim();
  if (title.length < 3 || title.length > 140) fail(400, 'Title must be 3-140 characters');
  const names = normalizeOutcomes(input);
  const isBinary = names.length === 2 && names[0].toLowerCase() === 'yes' && names[1].toLowerCase() === 'no';
  const b = Math.min(2000, Math.max(20, Number(input.b) || 150));
  const t = opts.t || now();
  const closesAt = input.closesAt ? Number(input.closesAt) : null;
  if (closesAt !== null && !Number.isFinite(closesAt)) fail(400, 'Bad close time');
  const m = {
    id: uid(), title, description: String(input.description || '').slice(0, 2000),
    category: (String(input.category || '').trim().slice(0, 30)) || 'General',
    binary: isBinary,
    outcomes: names.map((n, i) => ({ id: uid(), name: n, q: 0, color: isBinary ? (i === 0 ? '#199e70' : '#e66767') : PALETTE[i % PALETTE.length] })),
    b, status: 'open', closesAt, featured: !!input.featured, live: !!input.live,
    createdAt: t, createdBy: opts.by || null, resolvedOutcomeId: null, resolvedAt: null,
    volume: 0, tradeCount: 0, lastTradeAt: null, history: [], flags: [],
  };
  pushHistory(m, t, lmsrPrices(qsOf(m), b));
  db.markets[m.id] = m;
  db.events.push({ id: uid(), type: 'new_market', t, marketId: m.id, userId: opts.by || undefined });
  return m;
}

const posKey = (u, m) => `${u}:${m}`;
function getPosition(userId, marketId, create = true) {
  const k = posKey(userId, marketId);
  let p = db.positions[k];
  if (!p && create) { p = db.positions[k] = { userId, marketId, shares: {}, invested: 0, settled: null }; invalidate(); }
  return p;
}
const positionIndex = cached(() => {
  const byUser = new Map(); const byMarket = new Map();
  for (const p of Object.values(db.positions)) {
    if (!byUser.has(p.userId)) byUser.set(p.userId, []);
    if (!byMarket.has(p.marketId)) byMarket.set(p.marketId, []);
    byUser.get(p.userId).push(p); byMarket.get(p.marketId).push(p);
  }
  return { byUser, byMarket };
});
const positionsForMarket = (marketId) => positionIndex().byMarket.get(marketId) || [];
const positionsForUser = (userId) => positionIndex().byUser.get(userId) || [];
const hasShares = (p) => Object.values(p.shares).some((s) => s > 1e-6);

function executeTrade({ user, market, outcomeId, side, amount, shares, t = now(), silent = false }) {
  if (effStatus(market) !== 'open') fail(400, 'This market is not open for trading');
  const i = market.outcomes.findIndex((o) => o.id === outcomeId);
  if (i < 0) fail(400, 'Unknown outcome');
  const qs = qsOf(market);
  const b = market.b;
  const pos = getPosition(user.id, market.id);
  let delta, cash;
  if (side === 'buy') {
    amount = round2(Number(amount));
    if (!(amount >= 1)) fail(400, `Minimum bet is ${db.settings.currency}1`);
    if (amount > user.balance + 1e-9) fail(400, `Not enough cash (you have ${db.settings.currency}${user.balance.toFixed(2)})`);
    delta = lmsrSharesForCost(qs, b, i, amount);
    cash = -amount;
  } else if (side === 'sell') {
    shares = Number(shares);
    const owned = pos.shares[outcomeId] || 0;
    if (!(shares > 0)) fail(400, 'Enter how many shares to sell');
    if (shares > owned + 1e-6) fail(400, `You only own ${owned.toFixed(2)} shares of that outcome`);
    shares = Math.min(shares, owned);
    delta = -shares;
    cash = round2(-lmsrTradeCost(qs, b, i, delta));
    if (cash < 0.01) fail(400, 'That sale is worth less than a cent');
  } else fail(400, 'side must be buy or sell');

  market.outcomes[i].q += delta;
  user.balance = round2(user.balance + cash);
  pos.shares[outcomeId] = (pos.shares[outcomeId] || 0) + delta;
  if (pos.shares[outcomeId] < 1e-6) pos.shares[outcomeId] = 0;
  pos.invested = round2(pos.invested - cash);
  const after = lmsrPrices(qsOf(market), b);
  const trade = {
    id: uid(), t, userId: user.id, marketId: market.id, outcomeId, side,
    shares: Math.abs(delta), cost: Math.abs(cash), price: Math.abs(cash) / Math.max(Math.abs(delta), 1e-9), priceAfter: after[i],
  };
  db.trades.push(trade);
  market.volume = round2(market.volume + Math.abs(cash));
  market.tradeCount++;
  market.lastTradeAt = t;
  user.tradeCount++;
  pushHistory(market, t, after);
  persist(db);
  if (!silent) {
    broadcast({ type: 'market', market: marketView(market) });
    broadcast({ type: 'trade', trade: tradeView(trade) });
    broadcast({ type: 'leaderboard' });
  }
  return trade;
}

function resolveMarket(m, outcomeId, opts = {}) {
  if (m.status === 'resolved' || m.status === 'voided') fail(400, 'This market is already settled');
  const o = m.outcomes.find((x) => x.id === outcomeId);
  if (!o) fail(400, 'Unknown outcome');
  const t = opts.t || now();
  m.status = 'resolved'; m.resolvedOutcomeId = outcomeId; m.resolvedAt = t;
  for (const p of positionsForMarket(m.id)) {
    if (p.settled) continue;
    const u = db.users[p.userId];
    const payout = round2(p.shares[outcomeId] || 0);
    const pnl = round2(payout - p.invested);
    if (u) {
      u.balance = round2(u.balance + payout);
      u.realizedPnl = round2(u.realizedPnl + pnl);
      if (pnl > u.biggestWin) u.biggestWin = pnl;
      if (pnl > 0) u.wins++;
    }
    p.settled = { payout, pnl, t };
  }
  db.events.push({ id: uid(), type: 'resolved', t, marketId: m.id, outcomeId });
  persist(db);
  if (!opts.silent) {
    broadcast({ type: 'market', market: marketView(m) });
    broadcast({ type: 'settled', marketId: m.id, title: m.title, outcomeName: o.name });
    broadcast({ type: 'feed' });
    broadcast({ type: 'leaderboard' });
  }
}

function recomputeBiggestWin(u) {
  let best = 0;
  for (const p of positionsForUser(u.id)) if (p.settled && !p.settled.voided && p.settled.pnl > best) best = p.settled.pnl;
  u.biggestWin = best;
}

// Reverse a resolution or a void: take payouts/refunds back and put the market
// back to "closed" so an admin can resolve it again (or void it).
function unsettleMarket(m) {
  const touched = new Set();
  for (const p of positionsForMarket(m.id)) {
    if (!p.settled) continue;
    const u = db.users[p.userId];
    if (u) {
      u.balance = round2(u.balance - p.settled.payout);
      if (!p.settled.voided) {
        u.realizedPnl = round2(u.realizedPnl - p.settled.pnl);
        if (p.settled.pnl > 0) u.wins = Math.max(0, u.wins - 1);
      }
      touched.add(u);
    }
    p.settled = null;
  }
  m.status = 'closed'; m.resolvedOutcomeId = null; m.resolvedAt = null;
  for (const u of touched) recomputeBiggestWin(u);
}

// Void = every bet is undone as if it never happened. Each player gets back
// exactly their net stake (what they paid in minus what they sold out for).
function voidMarket(m) {
  if (m.status === 'voided') fail(400, 'This market is already voided');
  if (m.status === 'resolved') unsettleMarket(m);
  const t = now();
  m.status = 'voided'; m.resolvedAt = t;
  for (const p of positionsForMarket(m.id)) {
    if (p.settled) continue;
    const u = db.users[p.userId];
    const refund = round2(p.invested);
    if (u) u.balance = round2(u.balance + refund);
    p.settled = { payout: refund, pnl: 0, t, voided: true };
  }
  db.events.push({ id: uid(), type: 'voided', t, marketId: m.id });
  persist(db);
  broadcast({ type: 'market', market: marketView(m) });
  broadcast({ type: 'settled', marketId: m.id, title: m.title, voided: true });
  broadcast({ type: 'feed' });
  broadcast({ type: 'leaderboard' });
}

// Flip markets to closed when their timer runs out so clients get a push.
setInterval(() => {
  const t = now();
  for (const m of Object.values(db.markets)) {
    if (m.status === 'open' && m.closesAt && t > m.closesAt) {
      m.status = 'closed';
      persist(db);
      broadcast({ type: 'market', market: marketView(m) });
    }
  }
}, 10000);

// ---------------------------------------------------------------- views
function priceChanges(m, prices, windowMs = 3600e3) {
  const cutoff = now() - windowMs;
  let ref = m.history[0];
  for (const h of m.history) { if (h.t <= cutoff) ref = h; else break; }
  return prices.map((p, i) => p - (ref?.p[i] ?? p));
}

function marketView(m, detail = false) {
  const prices = lmsrPrices(qsOf(m), m.b);
  const ch = priceChanges(m, prices);
  const v = {
    id: m.id, title: m.title, description: m.description, category: m.category, binary: m.binary,
    status: effStatus(m), closesAt: m.closesAt, createdAt: m.createdAt, featured: m.featured, live: m.live,
    b: m.b, volume: m.volume, tradeCount: m.tradeCount, lastTradeAt: m.lastTradeAt,
    resolvedOutcomeId: m.resolvedOutcomeId, resolvedAt: m.resolvedAt,
    createdBy: m.createdBy ? publicUser(db.users[m.createdBy]) : null,
    flags: (m.flags || []).map((f) => ({ user: publicUser(db.users[f.userId]), reason: f.reason, t: f.t })),
    traders: positionsForMarket(m.id).filter(hasShares).length,
    outcomes: m.outcomes.map((o, i) => ({ id: o.id, name: o.name, color: o.color, q: o.q, price: prices[i], change: ch[i] })),
    spark: m.history.slice(-40).map((h) => [h.t, ...h.p]),
  };
  if (detail) v.history = m.history.map((h) => [h.t, ...h.p]);
  return v;
}

function tradeView(t) {
  const u = db.users[t.userId]; const m = db.markets[t.marketId];
  const o = m?.outcomes.find((x) => x.id === t.outcomeId);
  return {
    kind: 'trade', id: t.id, t: t.t, user: publicUser(u), marketId: t.marketId, marketTitle: m?.title || '(deleted market)',
    outcomeId: t.outcomeId, outcomeName: o?.name || '?', outcomeColor: o?.color || '#898781',
    side: t.side, shares: t.shares, cost: t.cost, price: t.price, priceAfter: t.priceAfter,
  };
}
function eventView(e) {
  const m = e.marketId ? db.markets[e.marketId] : null;
  const o = m?.outcomes.find((x) => x.id === e.outcomeId);
  return {
    kind: e.type, id: e.id, t: e.t, marketId: e.marketId || null, marketTitle: m?.title || null,
    outcomeName: o?.name || null, outcomeColor: o?.color || null,
    user: e.userId ? publicUser(db.users[e.userId]) : null, amount: e.amount ?? null, note: e.note || null,
  };
}
const feed = (limit = 80) => feedCached(String(limit));
const feedCached = cached((key) => buildFeed(Number(key)));
function buildFeed(limit) {
  const items = db.trades.slice(-limit).map(tradeView).concat(db.events.slice(-limit).map(eventView));
  items.sort((a, b) => b.t - a.t);
  return items.slice(0, limit);
}

function priceCache() {
  const cache = new Map();
  return (m) => { if (!cache.has(m.id)) cache.set(m.id, lmsrPrices(qsOf(m), m.b)); return cache.get(m.id); };
}

function netWorth(u, pricesOf = priceCache()) {
  let v = u.balance;
  for (const p of positionsForUser(u.id)) {
    if (p.settled) continue;
    const m = db.markets[p.marketId]; if (!m) continue;
    const prices = pricesOf(m);
    m.outcomes.forEach((o, i) => { v += (p.shares[o.id] || 0) * prices[i]; });
  }
  return round2(v);
}

const leaderboard = cached(buildLeaderboard);
function buildLeaderboard() {
  const pricesOf = priceCache();
  return Object.values(db.users)
    .map((u) => {
      const nw = netWorth(u, pricesOf);
      return { id: u.id, name: u.name, color: u.color, bot: !!u.bot, netWorth: nw, cash: u.balance, pnl: round2(nw - u.deposited), tradeCount: u.tradeCount, biggestWin: u.biggestWin, realizedPnl: u.realizedPnl, wins: u.wins };
    })
    .sort((a, b) => b.netWorth - a.netWorth || b.tradeCount - a.tradeCount || a.name.localeCompare(b.name))
    .map((r, i) => ({ rank: i + 1, ...r }));
}

function userPositions(u) {
  const out = [];
  const pricesOf = priceCache();
  for (const p of positionsForUser(u.id)) {
    const m = db.markets[p.marketId]; if (!m) continue;
    const prices = pricesOf(m);
    const outcomes = m.outcomes.map((o, i) => {
      const sh = p.shares[o.id] || 0;
      const value = p.settled ? (m.resolvedOutcomeId === o.id ? sh : 0) : sh * prices[i];
      return { outcomeId: o.id, name: o.name, color: o.color, shares: sh, price: prices[i], value };
    }).filter((x) => x.shares > 1e-6);
    if (!outcomes.length && !p.settled) continue;
    if (p.settled && !outcomes.length && Math.abs(p.invested) < 0.005) continue;
    const value = p.settled ? p.settled.payout : round2(outcomes.reduce((a, x) => a + x.value, 0));
    out.push({
      marketId: m.id, marketTitle: m.title, status: effStatus(m), binary: m.binary, resolvedOutcomeId: m.resolvedOutcomeId,
      resolvedOutcomeName: m.outcomes.find((o) => o.id === m.resolvedOutcomeId)?.name || null,
      outcomes, invested: p.invested, value, pnl: round2(value - p.invested), settled: p.settled,
    });
  }
  out.sort((a, b) => (a.settled ? 1 : 0) - (b.settled ? 1 : 0) || (b.settled?.t || 0) - (a.settled?.t || 0) || b.value - a.value);
  return out;
}

function meView(u) {
  if (!u) return null;
  const lb = leaderboard();
  const row = lb.find((r) => r.id === u.id);
  return {
    user: { ...publicUser(u), balance: u.balance, deposited: u.deposited, tradeCount: u.tradeCount, realizedPnl: u.realizedPnl, biggestWin: u.biggestWin, wins: u.wins },
    positions: userPositions(u),
    netWorth: row?.netWorth ?? u.balance, pnl: row?.pnl ?? 0, rank: row?.rank ?? null, players: lb.length,
  };
}

// ---------------------------------------------------------------- seeding
const ctx = { get db() { return db; }, createMarket, createUser, executeTrade, resolveMarket };
if (!db.seeded) {
  starterPack(ctx);
  if (DEMO) demoPack(ctx);
  db.seeded = true;
  persistNow(db);
}
flushOnExit(() => db);

// ---------------------------------------------------------------- app
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

const requireUser = (req, res, next) => { const u = currentUser(req); if (!u) fail(401, 'Sign in first'); req.user = u; next(); };
const requireAdmin = (req, res, next) => { const u = currentUser(req); if (!u) fail(401, 'Sign in first'); if (!u.isAdmin) fail(403, 'Admins only'); req.user = u; next(); };
const marketOr404 = (id) => db.markets[id] || fail(404, 'Market not found');
const marketList = () => Object.values(db.markets).sort((a, b) => b.createdAt - a.createdAt).map((m) => marketView(m));

app.get('/api/bootstrap', (req, res) => {
  const u = currentUser(req);
  res.json({ me: meView(u), settings: db.settings, markets: marketList(), feed: feed(), leaderboard: leaderboard(), serverTime: now(), demo: DEMO });
});

app.post('/api/auth', (req, res) => {
  const { name, pin } = req.body || {};
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  let u = Object.values(db.users).find((x) => x.name.toLowerCase() === n.toLowerCase());
  let created = false;
  if (u) {
    if (u.bot) fail(400, 'That name belongs to a demo bot. Pick another.');
    if (hashPin(pin, u.salt) !== u.pinHash) fail(401, 'Wrong PIN for that name');
  } else {
    u = createUser(n, pin);
    created = true;
    db.events.push({ id: uid(), type: 'joined', t: now(), userId: u.id, amount: u.balance });
    broadcast({ type: 'feed' });
    broadcast({ type: 'leaderboard' });
  }
  const sid = crypto.randomBytes(18).toString('base64url');
  db.sessions[sid] = u.id;
  persist(db);
  res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
  res.json({ me: meView(u), created });
});

app.post('/api/logout', (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) { delete db.sessions[sid]; persist(db); }
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ me: meView(currentUser(req)) }));
// One request per tab after each bet, instead of three.
app.get('/api/live', (req, res) => res.json({ me: meView(currentUser(req)), leaderboard: leaderboard(), feed: feed() }));
app.get('/api/leaderboard', (req, res) => res.json({ leaderboard: leaderboard() }));
app.get('/api/feed', (req, res) => res.json({ feed: feed(Math.min(300, Number(req.query.limit) || 80)) }));
app.get('/api/markets', (req, res) => res.json({ markets: marketList() }));

app.get('/api/markets/:id', (req, res) => {
  const m = marketOr404(req.params.id);
  const u = currentUser(req);
  const trades = db.trades.filter((t) => t.marketId === m.id).slice(-40).reverse().map(tradeView);
  const pos = u ? getPosition(u.id, m.id, false) : null;
  res.json({ market: marketView(m, true), trades, position: pos || null });
});

app.post('/api/markets/:id/trade', requireUser, (req, res) => {
  const m = marketOr404(req.params.id);
  const { outcomeId, side, amount, shares } = req.body || {};
  const trade = executeTrade({ user: req.user, market: m, outcomeId, side, amount, shares });
  res.json({ trade: tradeView(trade), me: meView(req.user), market: marketView(m, true), position: getPosition(req.user.id, m.id, false) });
});

// Anyone signed in can create a market (unless admins turn it off).
// Only admins can resolve, void, or set featured/liquidity.
app.post('/api/markets', requireUser, (req, res) => {
  const u = req.user;
  const input = { ...(req.body || {}) };
  if (!u.isAdmin) {
    if (!db.settings.allowUserMarkets) fail(403, 'Admins have turned off player-created markets. Send a suggestion instead.');
    const pending = Object.values(db.markets).filter((m) => m.createdBy === u.id && (m.status === 'open' || m.status === 'closed')).length;
    if (pending >= 8) fail(429, 'You already have 8 markets waiting on a result. Let some settle first.');
    delete input.featured; delete input.b;
  }
  const title = String(input.title || '').trim().toLowerCase();
  if (Object.values(db.markets).some((m) => effStatus(m) === 'open' && m.title.trim().toLowerCase() === title)) fail(409, 'There is already an open market with that exact question');
  if (input.closesAt && Number(input.closesAt) < now() + 60e3) fail(400, 'Pick a close time in the future');
  const m = createMarket(input, { by: u.id });
  persist(db);
  broadcast({ type: 'market', market: marketView(m), isNew: true });
  broadcast({ type: 'feed' });
  res.json({ market: marketView(m, true) });
});

app.delete('/api/markets/:id', requireUser, (req, res) => {
  const m = marketOr404(req.params.id);
  if (m.createdBy !== req.user.id) fail(403, 'Only the creator can delete their own market');
  if (m.tradeCount > 0) fail(400, 'Someone already bet on this. Report a problem and an admin can void it.');
  delete db.markets[m.id];
  db.events = db.events.filter((e) => e.marketId !== m.id);
  persist(db);
  broadcast({ type: 'market_deleted', marketId: m.id });
  broadcast({ type: 'feed' });
  res.json({ ok: true });
});

app.post('/api/markets/:id/flag', requireUser, (req, res) => {
  const m = marketOr404(req.params.id);
  if (m.status === 'voided') fail(400, 'This market is already voided');
  const reason = String(req.body?.reason || '').trim().slice(0, 300);
  if (reason.length < 3) fail(400, 'Tell the admins what looks off');
  m.flags = m.flags || [];
  const existing = m.flags.find((f) => f.userId === req.user.id);
  if (existing) { existing.reason = reason; existing.t = now(); } else m.flags.push({ userId: req.user.id, reason, t: now() });
  db.events.push({ id: uid(), type: 'flag', t: now(), marketId: m.id, userId: req.user.id, note: reason });
  persist(db);
  broadcast({ type: 'market', market: marketView(m) });
  broadcast({ type: 'flag', marketId: m.id, title: m.title, reason, user: publicUser(req.user) });
  broadcast({ type: 'feed' });
  res.json({ ok: true });
});

app.post('/api/suggestions', requireUser, (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 300);
  if (text.length < 5) fail(400, 'Give us a little more detail');
  db.suggestions.push({ id: uid(), userId: req.user.id, text, t: now(), status: 'new' });
  persist(db);
  broadcast({ type: 'suggestion' });
  res.json({ ok: true });
});

app.get('/api/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// ---------------------------------------------------------------- admin
app.post('/api/admin/login', requireUser, (req, res) => {
  const pw = String(req.body?.password || '');
  if (pw.length !== ADMIN_PASSWORD.length || !crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(ADMIN_PASSWORD))) fail(401, 'Wrong admin password');
  req.user.isAdmin = true;
  persist(db);
  res.json({ me: meView(req.user) });
});

app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const pricesOf = priceCache();
  res.json({
    users: Object.values(db.users).map((u) => ({ ...publicUser(u), balance: u.balance, deposited: u.deposited, netWorth: netWorth(u, pricesOf), tradeCount: u.tradeCount, createdAt: u.createdAt })).sort((a, b) => b.netWorth - a.netWorth),
    suggestions: db.suggestions.slice().reverse().map((s) => ({ ...s, user: publicUser(db.users[s.userId]) })),
    dbFile: DB_FILE,
  });
});

app.post('/api/admin/markets', requireAdmin, (req, res) => {
  const m = createMarket(req.body || {}, { by: req.user.id });
  persist(db);
  broadcast({ type: 'market', market: marketView(m), isNew: true });
  broadcast({ type: 'feed' });
  res.json({ market: marketView(m, true) });
});

app.patch('/api/admin/markets/:id', requireAdmin, (req, res) => {
  const m = marketOr404(req.params.id);
  const b = req.body || {};
  if (b.title !== undefined) { const t = String(b.title).trim(); if (t.length < 3 || t.length > 140) fail(400, 'Title must be 3-140 characters'); m.title = t; }
  if (b.description !== undefined) m.description = String(b.description).slice(0, 2000);
  if (b.category !== undefined) m.category = String(b.category).trim().slice(0, 30) || 'General';
  if (b.closesAt !== undefined) { m.closesAt = b.closesAt ? Number(b.closesAt) : null; if (m.status === 'closed' && (!m.closesAt || m.closesAt > now())) m.status = 'open'; }
  if (b.featured !== undefined) m.featured = !!b.featured;
  if (b.live !== undefined) m.live = !!b.live;
  if (b.b !== undefined) { if (m.tradeCount > 0) fail(400, 'Liquidity can only change before the first trade'); m.b = Math.min(2000, Math.max(20, Number(b.b) || 150)); }
  if (Array.isArray(b.outcomes)) {
    const names = normalizeOutcomes({ outcomes: b.outcomes });
    if (names.length === m.outcomes.length) {
      m.outcomes.forEach((o, i) => { o.name = names[i]; });
    } else if (m.tradeCount === 0) {
      const isBinary = names.length === 2 && names[0].toLowerCase() === 'yes' && names[1].toLowerCase() === 'no';
      m.binary = isBinary;
      m.outcomes = names.map((n, i) => ({ id: uid(), name: n, q: 0, color: isBinary ? (i === 0 ? '#199e70' : '#e66767') : PALETTE[i % PALETTE.length] }));
      m.history = [];
      pushHistory(m, now(), lmsrPrices(qsOf(m), m.b));
    } else fail(400, 'You can rename outcomes, but not add or remove them after trading has started');
  }
  persist(db);
  broadcast({ type: 'market', market: marketView(m) });
  res.json({ market: marketView(m, true) });
});

app.post('/api/admin/markets/:id/close', requireAdmin, (req, res) => {
  const m = marketOr404(req.params.id);
  if (m.status !== 'open') fail(400, 'Only open markets can be closed');
  m.status = 'closed'; m.closesAt = Math.min(m.closesAt || Infinity, now());
  persist(db); broadcast({ type: 'market', market: marketView(m) });
  res.json({ market: marketView(m, true) });
});
app.post('/api/admin/markets/:id/reopen', requireAdmin, (req, res) => {
  const m = marketOr404(req.params.id);
  if (m.status !== 'closed') fail(400, 'Only closed markets can be reopened');
  m.status = 'open'; m.closesAt = req.body?.closesAt ? Number(req.body.closesAt) : null;
  persist(db); broadcast({ type: 'market', market: marketView(m) });
  res.json({ market: marketView(m, true) });
});
app.post('/api/admin/markets/:id/resolve', requireAdmin, (req, res) => {
  const m = marketOr404(req.params.id);
  resolveMarket(m, req.body?.outcomeId);
  res.json({ market: marketView(m, true) });
});
app.post('/api/admin/markets/:id/void', requireAdmin, (req, res) => {
  const m = marketOr404(req.params.id);
  voidMarket(m);
  res.json({ market: marketView(m, true) });
});
app.post('/api/admin/markets/:id/unresolve', requireAdmin, (req, res) => {
  const m = marketOr404(req.params.id);
  if (m.status !== 'resolved' && m.status !== 'voided') fail(400, 'Only resolved or voided markets can be undone');
  unsettleMarket(m);
  db.events.push({ id: uid(), type: 'unresolved', t: now(), marketId: m.id });
  persist(db);
  broadcast({ type: 'market', market: marketView(m) });
  broadcast({ type: 'settled', marketId: m.id, title: m.title, undone: true });
  broadcast({ type: 'feed' });
  broadcast({ type: 'leaderboard' });
  res.json({ market: marketView(m, true) });
});
app.post('/api/admin/markets/:id/clear-flags', requireAdmin, (req, res) => {
  const m = marketOr404(req.params.id);
  m.flags = [];
  persist(db);
  broadcast({ type: 'market', market: marketView(m) });
  res.json({ ok: true });
});
app.delete('/api/admin/markets/:id', requireAdmin, (req, res) => {
  const m = marketOr404(req.params.id);
  if (m.status === 'open' || m.status === 'closed') voidMarket(m);
  delete db.markets[m.id];
  for (const k of Object.keys(db.positions)) if (db.positions[k].marketId === m.id) delete db.positions[k];
  db.trades = db.trades.filter((t) => t.marketId !== m.id);
  db.events = db.events.filter((e) => e.marketId !== m.id);
  persist(db);
  broadcast({ type: 'market_deleted', marketId: m.id });
  broadcast({ type: 'feed' });
  broadcast({ type: 'leaderboard' });
  res.json({ ok: true });
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const s = db.settings;
  if (b.eventName !== undefined) s.eventName = String(b.eventName).trim().slice(0, 60) || s.eventName;
  if (b.tagline !== undefined) s.tagline = String(b.tagline).trim().slice(0, 120);
  if (b.prizeText !== undefined) s.prizeText = String(b.prizeText).trim().slice(0, 500);
  if (b.allowUserMarkets !== undefined) s.allowUserMarkets = !!b.allowUserMarkets;
  if (b.currency !== undefined) s.currency = String(b.currency).trim().slice(0, 4) || '$';
  if (b.startingBalance !== undefined) { const n = Number(b.startingBalance); if (!(n >= 1 && n <= 1e7)) fail(400, 'Starting balance must be between 1 and 10,000,000'); s.startingBalance = round2(n); }
  persist(db);
  broadcast({ type: 'settings', settings: s });
  res.json({ settings: s });
});

app.post('/api/admin/users/:id/credit', requireAdmin, (req, res) => {
  const u = db.users[req.params.id] || fail(404, 'User not found');
  const amount = round2(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount === 0) fail(400, 'Amount must be a non-zero number');
  u.balance = round2(u.balance + amount);
  u.deposited = round2(u.deposited + amount);
  db.events.push({ id: uid(), type: 'credit', t: now(), userId: u.id, amount, note: String(req.body?.reason || '').slice(0, 120) });
  persist(db);
  broadcast({ type: 'feed' }); broadcast({ type: 'leaderboard' }); broadcast({ type: 'balance', userId: u.id });
  res.json({ ok: true, balance: u.balance });
});

app.post('/api/admin/users/:id/admin', requireAdmin, (req, res) => {
  const u = db.users[req.params.id] || fail(404, 'User not found');
  u.isAdmin = !!req.body?.isAdmin;
  persist(db);
  res.json({ ok: true });
});

app.patch('/api/admin/suggestions/:id', requireAdmin, (req, res) => {
  const s = db.suggestions.find((x) => x.id === req.params.id) || fail(404, 'Not found');
  s.status = req.body?.status === 'done' ? 'done' : req.body?.status === 'dismissed' ? 'dismissed' : 'new';
  persist(db);
  res.json({ ok: true });
});

app.post('/api/admin/reset', requireAdmin, (req, res) => {
  const mode = req.body?.mode;
  const keepUsers = mode === 'markets';
  const fresh = emptyDb();
  fresh.settings = db.settings;
  if (keepUsers) {
    fresh.users = db.users;
    fresh.sessions = db.sessions;
    for (const u of Object.values(fresh.users)) { u.balance = db.settings.startingBalance; u.deposited = db.settings.startingBalance; u.tradeCount = 0; u.realizedPnl = 0; u.biggestWin = 0; u.wins = 0; }
  }
  if (req.body?.starter) { db = fresh; starterPack(ctx); }
  fresh.seeded = true;
  db = fresh;
  persistNow(db);
  broadcast({ type: 'reload' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- errors + start
app.use('/api', (req, res) => res.status(404).json({ error: 'No such endpoint' }));
app.use((err, req, res, next) => {
  if (!(err instanceof HttpError)) console.error(err);
  res.status(err.status || 500).json({ error: err instanceof HttpError ? err.message : 'Something broke on the server' });
});

// Express 5 calls this callback with an error if the port can't be bound, so
// check it instead of announcing a server that isn't actually listening.
app.listen(PORT, '0.0.0.0', (err) => {
  if (err) {
    console.error(err.code === 'EADDRINUSE'
      ? `\n  Port ${PORT} is already in use. Is HackStreet Bets already running?\n  Stop the other copy, or start this one with PORT=<another port>.\n`
      : `\n  Could not start the server: ${err.message}\n`);
    process.exit(1);
  }
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  console.log(`\n  HackStreet Bets is up${DEMO ? ' (demo data loaded)' : ''}`);
  console.log(`  Local:    http://localhost:${PORT}`);
  if (lan) console.log(`  Network:  http://${lan}:${PORT}   <- share this with the room`);
  console.log(`  Admin password: ${ADMIN_PASSWORD}${process.env.ADMIN_PASSWORD ? '' : '   (set ADMIN_PASSWORD=... to change)'}`);
  console.log(`  Data file: ${DB_FILE}\n`);
});
