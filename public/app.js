/* HackStreet Bets client. Plain JS, no build step. */
(() => {
'use strict';

// ------------------------------------------------------------ state
const S = {
  me: null, settings: {}, markets: new Map(), feed: [], leaderboard: [], demo: false,
  filter: 'All', query: '', detail: null, tradeState: null, adminTab: 'markets', adminData: null, chartRange: 'all',
};
const app = document.getElementById('app');
const $ = (sel, root = document) => root.querySelector(sel);

// ------------------------------------------------------------ utils
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cur = () => S.settings.currency || '$';
const money = (n, opts = {}) => {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: opts.dp ?? 2, maximumFractionDigits: opts.dp ?? 2 });
  return (v < 0 ? '-' : opts.sign && v > 0 ? '+' : '') + cur() + s;
};
const cents = (p) => `${Math.round(p * 100)}¢`;
const pct = (p) => `${Math.round(p * 100)}%`;
const chg = (d) => {
  const pts = Math.round(d * 100);
  if (!pts) return '<span class="chg muted">0</span>';
  return `<span class="chg ${pts > 0 ? 'up' : 'down'}">${pts > 0 ? '▲' : '▼'} ${Math.abs(pts)}</span>`;
};
const pnlCls = (v) => (v > 0.004 ? 'up' : v < -0.004 ? 'down' : 'muted');
const ago = (t) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const until = (t) => {
  const s = (t - Date.now()) / 1000;
  if (s <= 0) return 'closed';
  if (s < 3600) return `${Math.ceil(s / 60)}m left`;
  if (s < 86400) { const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60); return `${h}h ${m}m left`; }
  return `${Math.round(s / 86400)}d left`;
};
const fmtTime = (t) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const initial = (name) => esc((name || '?').trim()[0] || '?');
const avatar = (u, cls = '') => `<span class="avatar ${cls}" style="background:${esc(u?.color || '#555')}">${initial(u?.name)}</span>`;
const statusPill = (m) => `<span class="pill ${m.status}">${{ open: 'Open', closed: 'Closed', resolved: 'Resolved', voided: 'Voided' }[m.status]}</span>`;
const toLocalInput = (t) => { if (!t) return ''; const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fromLocalInput = (v) => (v ? new Date(v).getTime() : null);

// Client copy of the LMSR maths, for live trade previews only (server is authoritative).
const lmsr = {
  prices(qs, b) { const m = Math.max(...qs); const ex = qs.map((q) => Math.exp((q - m) / b)); const s = ex.reduce((a, c) => a + c, 0); return ex.map((e) => e / s); },
  cost(qs, b) { const m = Math.max(...qs); return m + b * Math.log(qs.reduce((a, q) => a + Math.exp((q - m) / b), 0)); },
  sharesFor(qs, b, i, cash) { const m = Math.max(...qs); const ex = qs.map((q) => Math.exp((q - m) / b)); const S0 = ex.reduce((a, c) => a + c, 0); return b * Math.log(S0 * Math.exp(cash / b) - S0 + ex[i]) + m - qs[i]; },
  sellValue(qs, b, i, sh) { const q2 = qs.slice(); q2[i] -= sh; return lmsr.cost(qs, b) - lmsr.cost(q2, b); },
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

// ------------------------------------------------------------ toasts
// One popover="manual" host holds the stack, so the browser lays toasts out
// (no overlap) and re-showing the host lifts it above any open dialog.
const hasPopover = 'popover' in HTMLElement.prototype;
const toastHost = document.createElement('div');
toastHost.id = 'toasts';
if (hasPopover) toastHost.popover = 'manual';
document.body.appendChild(toastHost);
function showHost() {
  if (!hasPopover) return;
  try { if (toastHost.matches(':popover-open')) toastHost.hidePopover(); toastHost.showPopover(); } catch { /* */ }
}
function toast(msg, kind = 'ok', ms = 3800) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  el.innerHTML = `<span>${msg}</span><button class="toast-x" aria-label="Dismiss">×</button>`;
  let gone = false;
  const close = () => {
    if (gone) return; gone = true;
    el.classList.add('leaving');
    setTimeout(() => { el.remove(); if (!toastHost.children.length && hasPopover) { try { toastHost.hidePopover(); } catch { /* */ } } }, 200);
  };
  el.querySelector('.toast-x').addEventListener('click', close);
  toastHost.prepend(el);
  while (toastHost.children.length > 4) toastHost.lastElementChild.remove();
  showHost();
  setTimeout(close, ms);
}

// ------------------------------------------------------------ dialogs
function openDialog(id) {
  const d = document.getElementById(id);
  if (!d.open) d.showModal();
  const first = d.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 30);
}
// Light-dismiss fallback for browsers without <dialog closedby>
if (!('closedBy' in HTMLDialogElement.prototype)) {
  document.querySelectorAll('dialog[closedby="any"]').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = r.top <= event.clientY && event.clientY <= r.top + r.height && r.left <= event.clientX && event.clientX <= r.left + r.width;
      if (!inside) dialog.close();
    });
  });
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="close-dialog"]');
  if (btn) btn.closest('dialog').close();
  if (e.target.closest('[data-action="suggest"]')) {
    if (canCreate()) { location.hash = '#/create'; return; }
    if (!S.me) { requireLogin(); return; }
    openDialog('suggestDialog');
  }
  if (e.target.closest('[data-action="suggest-dialog"]')) { if (!S.me) { requireLogin(); return; } openDialog('suggestDialog'); }
  if (e.target.closest('[data-action="flag"]')) { if (!S.me) { requireLogin(); return; } $('#flagError').hidden = true; openDialog('flagDialog'); }
});
const canCreate = () => !!(S.settings.allowUserMarkets || S.me?.user.isAdmin);
function requireLogin() { $('#authError').hidden = true; openDialog('authDialog'); return false; }

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $('#authError');
  err.hidden = true;
  try {
    const r = await api('/api/auth', { body: { name: f.name.value, pin: f.pin.value } });
    S.me = r.me;
    f.reset();
    $('#authDialog').close();
    toast(r.created ? `Welcome, <b>${esc(r.me.user.name)}</b>. You have ${money(r.me.user.balance)} to play with.` : `Welcome back, <b>${esc(r.me.user.name)}</b>.`);
    renderTopbar(); render();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
$('#flagForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const err = $('#flagError'); err.hidden = true;
  if (!S.detail) return;
  try { await api(`/api/markets/${S.detail.market.id}/flag`, { body: { reason: f.reason.value } }); f.reset(); $('#flagDialog').close(); toast('Reported. The admins will take a look.'); }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
});
$('#suggestForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const err = $('#suggestError'); err.hidden = true;
  try { await api('/api/suggestions', { body: { text: f.text.value } }); f.reset(); $('#suggestDialog').close(); toast('Suggestion sent to the admins.'); }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
});

// ------------------------------------------------------------ top bar & ticker
function renderTopbar() {
  $('#brand-event').textContent = S.settings.eventName || '';
  document.title = `HackStreet Bets · ${S.settings.eventName || ''}`;
  $('#authStart').textContent = money(S.settings.startingBalance, { dp: 0 });
  $('#nav-admin').hidden = !S.me;
  $('#nav-create').hidden = !canCreate();
  $('#footer-cta').textContent = canCreate() ? 'Create a market' : 'Suggest a market';
  const right = $('#topbar-right');
  if (!S.me) { right.innerHTML = `<button class="btn primary sm" data-action="login">Sign in to bet</button>`; return; }
  const u = S.me.user;
  right.innerHTML = `
    <a class="balance-pill cash" href="#/portfolio" title="Cash available"><span class="lbl">Cash</span><span class="num">${money(u.balance)}</span></a>
    <a class="balance-pill" href="#/portfolio" title="Cash + current value of open positions"><span class="lbl">Net worth</span><span class="num ${pnlCls(S.me.pnl)}">${money(S.me.netWorth)}</span></a>
    <button class="user-chip" data-action="account" title="Signed in as ${esc(u.name)}. Click to sign out.">${avatar(u)}<span class="name">${esc(u.name)}</span></button>`;
}
document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-action="login"]')) requireLogin();
  if (e.target.closest('[data-action="account"]')) {
    if (!confirm(`Sign out of ${S.me.user.name}? You can sign back in with your handle and PIN.`)) return;
    await api('/api/logout', { method: 'POST' });
    S.me = null; renderTopbar(); render();
  }
});

function renderTicker() {
  const open = [...S.markets.values()].filter((m) => m.status === 'open');
  if (!open.length) { $('#ticker').innerHTML = ''; return; }
  const items = open.map((m) => {
    const top = m.outcomes.reduce((a, o) => (o.price > a.price ? o : a));
    const label = m.binary ? `Yes ${cents(m.outcomes[0].price)}` : `${esc(top.name)} ${cents(top.price)}`;
    return `<a class="tk" href="#/m/${m.id}">${m.live ? '<span class="live-dot"></span> ' : ''}${esc(m.title)} <b>${label}</b> ${chg(m.binary ? m.outcomes[0].change : top.change)}</a><span class="tk-sep">•</span>`;
  }).join('');
  $('#ticker').innerHTML = `<div class="ticker-track">${items}${items}</div>`;
}

// ------------------------------------------------------------ routing
function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  return { name: parts[0] || 'markets', id: parts[1] };
}
window.addEventListener('hashchange', () => { S.detail = null; S.tradeState = S.pendingPick || null; S.pendingPick = null; render(); window.scrollTo(0, 0); });

function render() {
  const r = route();
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === r.name || (r.name === 'm' && a.dataset.nav === 'markets')));
  if (r.name === 'markets') return renderMarkets();
  if (r.name === 'm') return renderMarket(r.id);
  if (r.name === 'leaderboard') return renderLeaderboard();
  if (r.name === 'portfolio') return renderPortfolio();
  if (r.name === 'activity') return renderActivity();
  if (r.name === 'admin') return renderAdmin();
  if (r.name === 'create') return renderCreate();
  app.innerHTML = '<div class="empty">Nothing here. <a class="link" href="#/">Back to markets</a></div>';
}

// ------------------------------------------------------------ markets list
function sparkSvg(m, w = 90, h = 26) {
  const pts = m.spark || [];
  if (pts.length < 2) return '';
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
  const idx = m.binary ? [0] : m.outcomes.map((o, i) => i).sort((a, b) => m.outcomes[b].price - m.outcomes[a].price).slice(0, 2);
  const lines = idx.map((i) => {
    const d = pts.map((p, k) => `${k ? 'L' : 'M'}${(((p[0] - t0) / Math.max(1, t1 - t0)) * (w - 2) + 1).toFixed(1)},${((1 - p[i + 1]) * (h - 4) + 2).toFixed(1)}`).join('');
    return `<path d="${d}" fill="none" stroke="${m.outcomes[i].color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${lines}</svg>`;
}

function cardBody(m) {
  if (m.status === 'resolved') {
    const w = m.outcomes.find((o) => o.id === m.resolvedOutcomeId);
    return `<div class="winner-line">🏁 Resolved: <span class="dot" style="background:${w?.color}"></span><b>${esc(w?.name)}</b></div>`;
  }
  if (m.status === 'voided') return '<div class="winner-line">Voided. Everyone was refunded.</div>';
  if (m.binary) {
    const [y, n] = m.outcomes;
    return `<div class="yn">
      <button class="yes" data-quick="${m.id}:${y.id}"><span>Yes</span><span class="pr">${cents(y.price)}</span></button>
      <button class="no" data-quick="${m.id}:${n.id}"><span>No</span><span class="pr">${cents(n.price)}</span></button></div>`;
  }
  const sorted = [...m.outcomes].sort((a, b) => b.price - a.price);
  const shown = sorted.slice(0, 3);
  return `<div class="mini-rows">${shown.map((o) => `
    <div class="mini-row"><span class="nm"><span class="dot" style="background:${o.color}"></span><span>${esc(o.name)}</span></span><span class="pr">${pct(o.price)}</span>
    <div class="track"><div class="fill" style="width:${(o.price * 100).toFixed(1)}%;background:${o.color}"></div></div></div>`).join('')}
    ${sorted.length > 3 ? `<span class="more">+${sorted.length - 3} more</span>` : ''}</div>`;
}

function marketCard(m) {
  const right = m.status === 'open' ? (m.closesAt ? `<span class="right">${until(m.closesAt)}</span>` : '') : `<span class="right">${statusPill(m)}</span>`;
  return `<article class="card market-card ${m.status === 'open' ? '' : 'dim'}" data-open="${m.id}" id="mc-${m.id}">
    <div class="card-top">${m.live && m.status === 'open' ? '<span class="live-badge"><span class="live-dot"></span>LIVE</span>' : ''}<span class="pill cat">${esc(m.category)}</span>${m.flags?.length && m.status !== 'voided' ? '<span class="pill closed">⚠ reported</span>' : ''}${right}</div>
    <h3>${esc(m.title)}</h3>
    ${cardBody(m)}
    <div class="card-foot"><span>${money(m.volume, { dp: 0 })} vol</span><span>${m.traders} trader${m.traders === 1 ? '' : 's'}</span>${sparkSvg(m)}</div>
  </article>`;
}

function featuredBlock(m) {
  const sorted = [...m.outcomes].sort((a, b) => b.price - a.price);
  return `<section class="card featured" data-open="${m.id}" style="cursor:pointer">
    <div class="lead">
      <div class="card-top"><span class="pill cat">⭐ Featured · ${esc(m.category)}</span>${m.status !== 'open' ? statusPill(m) : m.closesAt ? `<span class="muted">${until(m.closesAt)}</span>` : ''}</div>
      <h1>${esc(m.title)}</h1>
      <p class="desc">${esc(m.description)}</p>
      <div class="stats"><span><b>${money(m.volume, { dp: 0 })}</b> volume</span><span><b>${m.traders}</b> traders</span><span><b>${m.tradeCount}</b> trades</span></div>
      <div><button class="btn primary" data-open="${m.id}">Place a bet →</button></div>
    </div>
    <div class="bars">${sorted.map((o) => `
      <button class="bar-row" data-quick="${m.id}:${o.id}">
        <span class="name"><span class="dot" style="background:${o.color}"></span><span>${esc(o.name)}</span></span>
        ${chg(o.change)}<span class="price">${pct(o.price)}</span>
        <span class="track"><span class="fill" style="display:block;width:${(o.price * 100).toFixed(1)}%;background:${o.color}"></span></span>
      </button>`).join('')}</div>
  </section>`;
}

function renderMarkets() {
  const all = [...S.markets.values()];
  const cats = ['All', 'Live', ...new Set(all.map((m) => m.category))];
  const featured = all.find((m) => m.featured && m.status !== 'voided');
  const q = S.query.toLowerCase();
  const match = (m) => (S.filter === 'All' || (S.filter === 'Live' ? m.live : m.category === S.filter)) && (!q || m.title.toLowerCase().includes(q) || m.outcomes.some((o) => o.name.toLowerCase().includes(q)));
  const live = all.filter((m) => m.live && m.status === 'open' && m !== featured);
  const showLive = live.length && S.filter === 'All' && !q;
  const list = all.filter((m) => m !== featured && match(m) && !(showLive && live.includes(m)));
  const openList = list.filter((m) => m.status === 'open').sort((a, b) => (b.live - a.live) || (b.lastTradeAt || b.createdAt) - (a.lastTradeAt || a.createdAt));
  const closedList = list.filter((m) => m.status === 'closed');
  const doneList = list.filter((m) => m.status === 'resolved' || m.status === 'voided').sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0));

  app.innerHTML = `
    ${!S.me ? `<div class="card" style="margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap"><span style="font-size:1.6rem">🎟️</span><div style="flex:1;min-width:200px"><b>Everyone starts with ${money(S.settings.startingBalance, { dp: 0 })} in play money.</b><div class="muted small">${esc(S.settings.tagline)}</div></div><button class="btn primary" data-action="login">Get my ${money(S.settings.startingBalance, { dp: 0 })}</button></div>` : ''}
    ${featured ? featuredBlock(featured) : ''}
    ${showLive ? `<div class="section-head"><h2><span class="live-badge"><span class="live-dot"></span></span> Happening now</h2><span class="muted small">Live side bets on the event itself</span></div>
      <div class="live-scroll">${live.map(marketCard).join('')}</div>` : ''}
    <div class="toolbar">
      <div class="chips" role="tablist">${cats.map((c) => `<button class="chip ${S.filter === c ? 'active' : ''}" data-filter="${esc(c)}">${c === 'Live' ? '🔴 ' : ''}${esc(c)}</button>`).join('')}</div>
      <input class="search" type="search" placeholder="Search markets" value="${esc(S.query)}" id="search" aria-label="Search markets">
    </div>
    <div class="grid">
      ${openList.map(marketCard).join('') || (closedList.length || doneList.length ? '' : '<div class="empty" style="grid-column:1/-1">No markets match. Try another filter.</div>')}
      ${closedList.length ? `<h2 class="grid-title muted small">AWAITING RESULT</h2>${closedList.map(marketCard).join('')}` : ''}
      ${doneList.length ? `<h2 class="grid-title muted small">SETTLED</h2>${doneList.map(marketCard).join('')}` : ''}
    </div>`;
  const s = $('#search');
  s.addEventListener('input', () => { S.query = s.value; const pos = s.selectionStart; renderMarkets(); const n = $('#search'); n.focus(); n.setSelectionRange(pos, pos); });
}

app.addEventListener('click', (e) => {
  const quick = e.target.closest('[data-quick]');
  if (quick) {
    e.stopPropagation();
    const [mid, oid] = quick.dataset.quick.split(':');
    S.pendingPick = { outcomeId: oid, side: 'buy', amount: '' };
    location.hash = `#/m/${mid}`;
    return;
  }
  const f = e.target.closest('[data-filter]');
  if (f) { S.filter = f.dataset.filter; renderMarkets(); return; }
  const open = e.target.closest('[data-open]');
  if (open && !e.target.closest('a')) { location.hash = `#/m/${open.dataset.open}`; }
});

// ------------------------------------------------------------ market detail
async function renderMarket(id) {
  if (!S.detail || S.detail.market.id !== id) {
    if (!S.markets.has(id)) app.innerHTML = '<div class="empty">Loading…</div>';
    try { S.detail = await api(`/api/markets/${id}`); }
    catch (e) { app.innerHTML = `<div class="empty">${esc(e.message)}. <a class="link" href="#/">Back to markets</a></div>`; return; }
  }
  const { market: m, trades, position } = S.detail;
  if (!S.tradeState || !m.outcomes.some((o) => o.id === S.tradeState.outcomeId)) {
    const best = m.binary ? m.outcomes[0] : [...m.outcomes].sort((a, b) => b.price - a.price)[0];
    S.tradeState = { outcomeId: best.id, side: 'buy', amount: S.tradeState?.amount || '' };
  }
  const winner = m.outcomes.find((o) => o.id === m.resolvedOutcomeId);
  const banner = m.status === 'resolved' ? `<div class="banner resolved">🏁 Resolved: <span class="dot" style="background:${winner.color}"></span>${esc(winner.name)}. Winning shares paid out ${cur()}1 each.</div>`
    : m.status === 'closed' ? '<div class="banner closed">⏸️ Trading is closed. Waiting for an admin to call the result.</div>'
    : m.status === 'voided' ? '<div class="banner voided">🚫 This market was voided. Everyone got their stake back.</div>' : '';
  const sorted = m.binary ? m.outcomes : [...m.outcomes].sort((a, b) => b.price - a.price);
  app.innerHTML = `
    <a class="back" href="#/">← All markets</a>
    <div class="market-page">
      <div>
        <div class="market-head">
          <div class="pills">${m.live && m.status === 'open' ? '<span class="live-badge"><span class="live-dot"></span>LIVE</span>' : ''}<span class="pill cat">${esc(m.category)}</span>${statusPill(m)}</div>
          <h1>${esc(m.title)}</h1>
          <div class="meta">${m.createdBy ? `<span class="byline">by ${avatar(m.createdBy, 'sm')}<b>${esc(m.createdBy.name)}</b></span>` : ''}<span><b>${money(m.volume, { dp: 0 })}</b> volume</span><span><b>${m.traders}</b> traders</span><span><b>${m.tradeCount}</b> trades</span>${m.closesAt ? `<span>${m.status === 'open' ? `Closes ${fmtTime(m.closesAt)} · <b>${until(m.closesAt)}</b>` : `Closed ${fmtTime(Math.min(m.closesAt, m.resolvedAt || m.closesAt))}`}</span>` : ''}</div>
        </div>
        ${banner}
        <div class="card chart-card">
          <div class="chart-tools"><span class="title">Implied probability</span>${['1h', '6h', 'all'].map((r) => `<button class="rng ${S.chartRange === r ? 'active' : ''}" data-range="${r}">${r === 'all' ? 'All' : r.toUpperCase()}</button>`).join('')}</div>
          <div class="chart-wrap"><canvas id="chart" role="img" aria-label="Price history chart for ${esc(m.title)}"></canvas><div class="chart-tip" id="chartTip" hidden></div></div>
          <div class="legend">${sorted.map((o) => `<span class="lg"><i style="background:${o.color}"></i>${esc(o.name)} <b>${pct(o.price)}</b></span>`).join('')}</div>
        </div>
        <div class="section-head"><h2>Outcomes</h2><span class="muted small">Price = chance the crowd gives it. Pays ${cur()}1 per share if it wins.</span></div>
        <div class="outcomes">${sorted.map((o) => outcomeRow(m, o, position)).join('')}</div>
        ${m.description ? `<div class="section-head"><h2>Rules</h2></div><div class="card"><p style="white-space:pre-wrap">${esc(m.description)}</p></div>` : ''}
        ${m.flags?.length ? `<div class="section-head"><h2>⚠️ Reported issues</h2><span class="muted small">Admins review these and can fix the result or void the market</span></div>
          <div class="card flags"><div class="trade-list">${m.flags.map((f) => `<div class="trade-item">${avatar(f.user)}<div class="what"><b>${esc(f.user?.name)}</b>: ${esc(f.reason)}</div><span class="when">${ago(f.t)}</span></div>`).join('')}</div></div>` : ''}
        <div class="market-actions">
          ${m.status !== 'voided' ? '<button class="btn sm ghost" data-action="flag">⚠️ Report a problem</button>' : ''}
          ${S.me && m.createdBy?.id === S.me.user.id && m.tradeCount === 0 && m.status === 'open' ? '<button class="btn sm danger" data-action="cancel-market">Delete my market</button>' : ''}
        </div>
      </div>
      <aside class="trade-col">
        <div class="card trade-panel" id="tradePanel"></div>
        <div id="positionBox"></div>
        ${S.me?.user.isAdmin ? adminCard(m) : ''}
      </aside>
      <section class="trades-area">
        <div class="section-head"><h2>Recent trades</h2></div>
        <div class="card">${trades.length ? `<div class="trade-list">${trades.map(tradeLine).join('')}</div>` : '<div class="empty">No trades yet. Be the first.</div>'}</div>
      </section>
    </div>`;
  renderTradePanel();
  renderPositionBox();
  drawChart();
}

function outcomeRow(m, o, position) {
  const sel = S.tradeState?.outcomeId === o.id && m.status === 'open';
  const owned = position?.shares?.[o.id] || 0;
  const win = m.resolvedOutcomeId === o.id;
  return `<button class="outcome-row ${sel ? 'selected' : ''} ${win ? 'winner' : ''}" style="--c:${o.color}" data-pick="${o.id}" ${m.status !== 'open' ? 'disabled' : ''}>
    <span class="nm"><span class="dot" style="background:${o.color}"></span><span class="t">${esc(o.name)}</span>${win ? ' 🏆' : ''}</span>
    <span class="pr">${pct(o.price)}</span>
    <span class="sub">${owned > 0.005 ? `You own ${owned.toFixed(1)} shares` : `${cents(o.price)} per share`}</span>
    ${chg(o.change)}
    <span class="track"><span class="fill" style="display:block;width:${(o.price * 100).toFixed(1)}%;background:${o.color}"></span></span>
  </button>`;
}

function adminCard(m) {
  const unsettled = m.status === 'open' || m.status === 'closed';
  return `<div class="card admin-card"><h3>🛡️ Admin</h3>
    ${unsettled ? `<div class="resolve-box"><select data-rsel="${m.id}" aria-label="Winning outcome">${m.outcomes.map((o) => `<option value="${o.id}">${esc(o.name)} (${pct(o.price)})</option>`).join('')}</select><button class="btn sm primary" data-aresolve="${m.id}">Resolve</button></div>` : ''}
    <div class="acts">
      ${m.status === 'open' ? `<button class="btn sm" data-aclose="${m.id}">Close trading</button>` : ''}
      ${m.status === 'closed' ? `<button class="btn sm" data-areopen="${m.id}">Reopen</button>` : ''}
      ${m.status === 'resolved' || m.status === 'voided' ? `<button class="btn sm" data-aunresolve="${m.id}">Undo result</button>` : ''}
      ${m.status !== 'voided' ? `<button class="btn sm danger" data-avoid="${m.id}">Void</button>` : ''}
      <button class="btn sm" data-aedit="${m.id}">Edit</button>
      ${m.flags?.length ? `<button class="btn sm" data-aclearflags="${m.id}">Clear reports</button>` : ''}
    </div></div>`;
}
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-action="cancel-market"]') || !S.detail) return;
  if (!confirm('Delete your market? Nobody has bet on it yet, so nothing is lost.')) return;
  try { await api(`/api/markets/${S.detail.market.id}`, { method: 'DELETE' }); toast('Market deleted.'); location.hash = '#/'; }
  catch (ex) { toast(esc(ex.message), 'err'); }
});

function tradeLine(t) {
  const verb = t.side === 'buy' ? 'bought' : 'sold';
  return `<div class="trade-item">${avatar(t.user)}
    <div class="what"><b>${esc(t.user?.name)}</b> ${verb} <b style="color:${t.outcomeColor}">${esc(t.outcomeName)}</b> <span class="muted">@ ${cents(t.price)}</span></div>
    <span class="amt ${t.side === 'buy' ? '' : 'muted'}">${money(t.cost)}</span><span class="when">${ago(t.t)}</span></div>`;
}

function renderTradePanel() {
  const box = $('#tradePanel'); if (!box || !S.detail) return;
  const { market: m, position } = S.detail;
  const ts = S.tradeState;
  const o = m.outcomes.find((x) => x.id === ts.outcomeId);
  const i = m.outcomes.indexOf(o);
  const qs = m.outcomes.map((x) => x.q);
  if (m.status !== 'open') {
    box.innerHTML = `<h3>Trading closed</h3><p class="muted small">${m.status === 'resolved' ? 'This one is settled. Payouts already hit everyone\'s balance.' : m.status === 'voided' ? 'All stakes were refunded.' : 'An admin will resolve this soon. Your shares pay out automatically.'}</p>`;
    return;
  }
  if (!S.me) {
    box.innerHTML = `<div class="tp-outcome" style="--c:${o.color}"><span class="nm">${esc(o.name)}</span><span class="pr">${cents(o.price)}</span></div>
      <p class="muted small" style="margin-bottom:12px">Sign in to get ${money(S.settings.startingBalance, { dp: 0 })} of play money and start betting.</p>
      <button class="btn primary big" data-action="login">Sign in to bet</button>`;
    return;
  }
  const owned = position?.shares?.[o.id] || 0;
  const bal = S.me.user.balance;
  const isBuy = ts.side === 'buy';
  const amt = Number(ts.amount) || 0;
  let est = '';
  let ok = false;
  if (isBuy && amt > 0) {
    const sh = lmsr.sharesFor(qs, m.b, i, amt);
    const q2 = qs.slice(); q2[i] += sh;
    const after = lmsr.prices(q2, m.b)[i];
    ok = amt >= 1 && amt <= bal + 1e-9;
    est = `<div class="est">
      <div class="r"><span class="muted">Shares</span><b>${sh.toFixed(2)}</b></div>
      <div class="r"><span class="muted">Avg price</span><b>${cents(amt / sh)}</b></div>
      <div class="r"><span class="muted">Price after</span><b>${cents(o.price)} → ${cents(after)}</b></div>
      <div class="r big"><span>Payout if ${esc(o.name)} wins</span><b class="up">${money(sh)}</b></div>
      <div class="r"><span class="muted">Profit</span><b class="up">${money(sh - amt, { sign: true })} (${Math.round(((sh - amt) / amt) * 100)}%)</b></div></div>`;
    if (amt > bal + 1e-9) est += `<p class="form-error small" style="margin:-4px 0 10px">You only have ${money(bal)}.</p>`;
  } else if (!isBuy && amt > 0) {
    const sh = Math.min(amt, owned);
    const val = lmsr.sellValue(qs, m.b, i, sh);
    const q2 = qs.slice(); q2[i] -= sh;
    ok = amt <= owned + 1e-6 && val >= 0.01;
    est = `<div class="est">
      <div class="r"><span class="muted">You receive</span><b class="up">${money(val)}</b></div>
      <div class="r"><span class="muted">Avg price</span><b>${cents(val / Math.max(sh, 1e-9))}</b></div>
      <div class="r"><span class="muted">Price after</span><b>${cents(o.price)} → ${cents(lmsr.prices(q2, m.b)[i])}</b></div></div>`;
    if (amt > owned + 1e-6) est += `<p class="form-error small" style="margin:-4px 0 10px">You only own ${owned.toFixed(2)} shares.</p>`;
  }
  const quick = isBuy
    ? [10, 25, 50, 100].map((v) => `<button data-amt="${v}">+${cur()}${v}</button>`).join('') + `<button data-amt="max">Max</button>`
    : ['25%', '50%', '100%'].map((v) => `<button data-shpct="${parseInt(v)}">${v}</button>`).join('');
  box.innerHTML = `
    <div class="seg" role="tablist"><button class="${isBuy ? 'active' : ''}" data-side="buy">Buy</button><button class="${!isBuy ? 'active' : ''}" data-side="sell" ${owned > 0.005 ? '' : 'disabled title="You don\'t own any shares of this outcome"'}>Sell</button></div>
    ${m.binary ? `<div class="yn" style="margin-bottom:12px">${m.outcomes.map((x, k) => `<button class="${k === 0 ? 'yes' : 'no'}" data-pick="${x.id}" style="${x.id === o.id ? 'outline:2px solid currentColor;outline-offset:-2px' : 'opacity:.7'}"><span>${esc(x.name)}</span><span class="pr">${cents(x.price)}</span></button>`).join('')}</div>`
      : `<div class="tp-outcome" style="--c:${o.color}"><span class="nm">${esc(o.name)}</span><span class="pr">${cents(o.price)}</span></div>`}
    <label>${isBuy ? 'Amount to bet' : `Shares to sell <span class="help">(you own ${owned.toFixed(2)})</span>`}
      <div class="amount-wrap">${isBuy ? `<span class="cur">${esc(cur())}</span>` : ''}<input id="amt" class="${isBuy ? '' : 'noprefix'}" type="number" inputmode="decimal" min="${isBuy ? 1 : 0}" step="${isBuy ? 1 : 0.01}" placeholder="0" value="${esc(ts.amount)}"></div>
    </label>
    <div class="quick">${quick}</div>
    ${est}
    <button class="btn big ${isBuy ? 'outcome' : 'primary'}" style="--c:${o.color}" id="tradeBtn" ${ok ? '' : 'disabled'}>${isBuy ? `Buy ${esc(o.name)}` : `Sell ${esc(o.name)}`}</button>
    <p class="fine">Cash ${money(bal)}. Prices move as people bet: buying pushes the price up, so big bets get a worse average price. Each share pays ${cur()}1 if the outcome wins, ${cur()}0 if not.</p>`;
  const input = $('#amt');
  input.addEventListener('input', () => { ts.amount = input.value; const pos = input.selectionStart; renderTradePanel(); const n = $('#amt'); n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* number inputs */ } });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('#tradeBtn').disabled) submitTrade(); });
}

function renderPositionBox() {
  const box = $('#positionBox'); if (!box || !S.detail) return;
  const { market: m, position } = S.detail;
  if (!position) { box.innerHTML = ''; return; }
  const rows = m.outcomes.filter((o) => (position.shares[o.id] || 0) > 0.005);
  if (!rows.length && !position.settled) { box.innerHTML = ''; return; }
  const value = position.settled ? position.settled.payout : rows.reduce((a, o) => a + position.shares[o.id] * o.price, 0);
  const pnl = value - position.invested;
  box.innerHTML = `<div class="card"><h3>Your position</h3><div class="pos-list">
    ${rows.map((o) => `<div class="pos-row"><span class="nm"><span class="dot" style="background:${o.color}"></span>${esc(o.name)}</span><span class="num">${position.shares[o.id].toFixed(2)} sh · ${position.settled ? (m.resolvedOutcomeId === o.id ? money(position.shares[o.id]) : money(0)) : money(position.shares[o.id] * o.price)}</span></div>`).join('')}
    <div class="pos-row muted"><span>Net cost</span><span class="num">${money(position.invested)}</span></div>
    <div class="pos-total"><span>${position.settled ? 'Final P&L' : 'Unrealized P&L'}</span><span class="num ${pnlCls(pnl)}">${money(pnl, { sign: true })}</span></div></div></div>`;
}

document.addEventListener('click', (e) => {
  if (!S.detail || route().name !== 'm') return;
  const ts = S.tradeState;
  const pick = e.target.closest('[data-pick]');
  if (pick && !pick.disabled) {
    ts.outcomeId = pick.dataset.pick;
    const owned = S.detail.position?.shares?.[ts.outcomeId] || 0;
    if (ts.side === 'sell' && owned <= 0.005) { ts.side = 'buy'; ts.amount = ''; }
    document.querySelectorAll('.outcome-row').forEach((r) => r.classList.toggle('selected', r.dataset.pick === ts.outcomeId));
    renderTradePanel();
    if (window.innerWidth < 900) $('#tradePanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const side = e.target.closest('[data-side]');
  if (side && !side.disabled) { ts.side = side.dataset.side; ts.amount = ''; renderTradePanel(); return; }
  const amt = e.target.closest('[data-amt]');
  if (amt) {
    const bal = Math.floor((S.me?.user.balance || 0) * 100) / 100;
    ts.amount = amt.dataset.amt === 'max' ? String(bal) : String(Math.min(bal, (Number(ts.amount) || 0) + Number(amt.dataset.amt)));
    renderTradePanel(); return;
  }
  const shp = e.target.closest('[data-shpct]');
  if (shp) {
    const owned = S.detail.position?.shares?.[ts.outcomeId] || 0;
    const v = Number(shp.dataset.shpct) === 100 ? owned : owned * Number(shp.dataset.shpct) / 100;
    ts.amount = String(Math.floor(v * 100) / 100 || v);
    if (Number(shp.dataset.shpct) === 100) ts.amount = String(owned);
    renderTradePanel(); return;
  }
  if (e.target.closest('#tradeBtn')) submitTrade();
  const rng = e.target.closest('[data-range]');
  if (rng) { S.chartRange = rng.dataset.range; document.querySelectorAll('[data-range]').forEach((b) => b.classList.toggle('active', b === rng)); drawChart(); }
});

let trading = false;
async function submitTrade() {
  if (trading) return;
  const ts = S.tradeState; const m = S.detail.market;
  const btn = $('#tradeBtn'); if (btn) btn.disabled = true;
  trading = true;
  try {
    const body = { outcomeId: ts.outcomeId, side: ts.side };
    if (ts.side === 'buy') body.amount = Number(ts.amount); else body.shares = Number(ts.amount);
    const r = await api(`/api/markets/${m.id}/trade`, { body });
    S.me = r.me;
    S.detail.market = r.market; S.detail.position = r.position;
    S.markets.set(r.market.id, { ...r.market, history: undefined });
    S.detail.trades = [r.trade, ...S.detail.trades.filter((t) => t.id !== r.trade.id)].slice(0, 40);
    const o = r.market.outcomes.find((x) => x.id === ts.outcomeId);
    toast(ts.side === 'buy'
      ? `Bought <b>${r.trade.shares.toFixed(2)}</b> shares of <b>${esc(o.name)}</b> for ${money(r.trade.cost)}. Price now ${cents(o.price)}.`
      : `Sold <b>${r.trade.shares.toFixed(2)}</b> shares of <b>${esc(o.name)}</b> for ${money(r.trade.cost)}.`);
    ts.amount = '';
    if (ts.side === 'sell' && !((r.position?.shares?.[ts.outcomeId] || 0) > 0.005)) ts.side = 'buy';
    renderTopbar(); renderMarket(m.id);
  } catch (ex) { toast(esc(ex.message), 'err'); if (btn) btn.disabled = false; }
  finally { trading = false; }
}

// ------------------------------------------------------------ chart (canvas, crosshair + tooltip)
let chartGeom = null;
function drawChart() {
  const canvas = $('#chart'); if (!canvas || !S.detail) return;
  const m = S.detail.market;
  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const nowT = Date.now();
  let hist = (m.history || []).slice();
  if (!hist.length) return;
  // extend the last point to "now" so flat lines reach the right edge
  const endT = m.status === 'open' ? nowT : Math.max(hist[hist.length - 1][0], m.resolvedAt || 0);
  hist.push([endT, ...hist[hist.length - 1].slice(1)]);
  const span = { '1h': 3600e3, '6h': 6 * 3600e3 }[S.chartRange];
  let t0 = hist[0][0];
  if (span && endT - span > t0) {
    t0 = endT - span;
    let k = 0; while (k < hist.length - 1 && hist[k + 1][0] <= t0) k++;
    hist = [[t0, ...hist[k].slice(1)], ...hist.slice(k + 1)];
  }
  const t1 = Math.max(endT, t0 + 60e3);
  const pad = { l: 8, r: 44, t: 10, b: 24 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * pw;
  const y = (p) => pad.t + (1 - p) * ph;
  // grid (recessive hairlines) + right axis labels
  ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  for (const g of [0, 0.25, 0.5, 0.75, 1]) {
    ctx.strokeStyle = g === 0 ? '#383835' : '#2c2c2a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, Math.round(y(g)) + 0.5); ctx.lineTo(pad.l + pw, Math.round(y(g)) + 0.5); ctx.stroke();
    ctx.fillStyle = '#898781'; ctx.textAlign = 'left'; ctx.fillText(`${g * 100}%`, pad.l + pw + 8, y(g));
  }
  // time labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const fmt = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const ticks = Math.max(2, Math.min(5, Math.floor(pw / 110)));
  for (let k = 0; k <= ticks; k++) { const t = t0 + ((t1 - t0) * k) / ticks; ctx.fillStyle = '#898781'; ctx.textAlign = k === 0 ? 'left' : k === ticks ? 'right' : 'center'; ctx.fillText(fmt(t), x(t), pad.t + ph + 7); }
  // series: binary -> just "Yes"; multi -> all (2px stepped lines)
  const series = m.binary ? [0] : m.outcomes.map((_, i) => i);
  const order = series.slice().sort((a, b) => m.outcomes[a].price - m.outcomes[b].price); // leader drawn last (on top)
  for (const i of order) {
    const o = m.outcomes[i];
    ctx.strokeStyle = o.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    hist.forEach((h, k) => { const X = x(h[0]), Y = y(h[i + 1]); if (k === 0) ctx.moveTo(X, Y); else { ctx.lineTo(X, y(hist[k - 1][i + 1])); ctx.lineTo(X, Y); } });
    ctx.stroke();
    if (m.binary) { // area wash for the single series
      ctx.lineTo(x(hist[hist.length - 1][0]), y(0)); ctx.lineTo(x(hist[0][0]), y(0)); ctx.closePath();
      ctx.fillStyle = o.color + '1a'; ctx.fill();
    }
    // end dot with surface ring
    const last = hist[hist.length - 1];
    ctx.beginPath(); ctx.arc(x(last[0]), y(last[i + 1]), 4, 0, Math.PI * 2); ctx.fillStyle = o.color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1a1a19'; ctx.stroke();
  }
  chartGeom = { hist, x, y, t0, t1, pad, pw, ph, series, m, W, H };
}
function chartHover(e) {
  const canvas = $('#chart'); const tip = $('#chartTip');
  if (!chartGeom || !canvas || !tip) return;
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const { hist, x, y, t0, t1, pad, pw, series, m } = chartGeom;
  if (mx < pad.l || mx > pad.l + pw) { tip.hidden = true; drawChart(); return; }
  const t = t0 + ((mx - pad.l) / pw) * (t1 - t0);
  let k = 0; while (k < hist.length - 1 && hist[k + 1][0] <= t) k++;
  const pt = hist[k];
  drawChart();
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#c3c2b7'; ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(Math.round(mx) + 0.5, pad.t); ctx.lineTo(Math.round(mx) + 0.5, pad.t + chartGeom.ph); ctx.stroke();
  for (const i of series) { ctx.beginPath(); ctx.arc(mx, y(pt[i + 1]), 4, 0, Math.PI * 2); ctx.fillStyle = m.outcomes[i].color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1a1a19'; ctx.stroke(); }
  const rows = series.map((i) => ({ o: m.outcomes[i], p: pt[i + 1] })).sort((a, b) => b.p - a.p);
  tip.innerHTML = `<div class="tt">${new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>${rows.map((rw) => `<div class="tr"><span class="nm"><span class="dot" style="background:${rw.o.color}"></span>${esc(rw.o.name)}</span><b>${pct(rw.p)}</b></div>`).join('')}`;
  tip.hidden = false;
  const tw = tip.offsetWidth;
  tip.style.left = `${mx + 12 + tw > r.width ? mx - tw - 24 : mx}px`;
}
document.addEventListener('pointermove', (e) => { if (e.target.id === 'chart') chartHover(e); });
document.addEventListener('pointerout', (e) => { if (e.target.id === 'chart') { const tip = $('#chartTip'); if (tip) tip.hidden = true; drawChart(); } });
window.addEventListener('resize', () => { if (route().name === 'm') drawChart(); });

// ------------------------------------------------------------ leaderboard
function renderLeaderboard() {
  const lb = S.leaderboard;
  const meId = S.me?.user.id;
  const top3 = lb.slice(0, 3);
  const medals = ['🥇', '🥈', '🥉'];
  app.innerHTML = `
    <div class="card prize"><span class="trophy">🏆</span><div><h2>The prize for 1st place</h2><p>${esc(S.settings.prizeText)}</p></div></div>
    ${top3.length ? `<div class="podium">${top3.map((r, k) => `<div class="card r${k + 1}"><span class="rank">#${k + 1}</span><span style="font-size:1.8rem">${medals[k]}</span>${avatar(r, 'lg')}<span class="nm">${esc(r.name)}${r.bot ? ' 🤖' : ''}</span><span class="nw">${money(r.netWorth, { dp: 0 })}</span><span class="small ${pnlCls(r.pnl)}">${money(r.pnl, { sign: true, dp: 0 })}</span></div>`).join('')}</div>` : ''}
    <div class="section-head"><h2>Standings</h2><span class="muted small">Ranked by net worth: cash + live value of open bets. Updates in real time.</span></div>
    <div class="card" style="padding:6px 8px">${lb.length ? `<div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Player</th><th class="num">Net worth</th><th class="num">P&amp;L</th><th class="num">Cash</th><th class="num">Trades</th><th class="num">Best call</th></tr></thead>
      <tbody>${lb.map((r) => `<tr class="${r.id === meId ? 'me' : ''}"><td class="rank-cell ${['gold', 'silver', 'bronze'][r.rank - 1] || ''}">${r.rank}</td>
        <td><span class="who">${avatar(r)}${esc(r.name)}${r.bot ? ' <span class="pill">bot</span>' : ''}${r.id === meId ? ' <span class="pill open">you</span>' : ''}</span></td>
        <td class="num"><b>${money(r.netWorth)}</b></td><td class="num ${pnlCls(r.pnl)}">${money(r.pnl, { sign: true })}</td><td class="num">${money(r.cash)}</td><td class="num">${r.tradeCount}</td><td class="num ${r.biggestWin > 0 ? 'up' : 'muted'}">${r.biggestWin > 0 ? money(r.biggestWin, { sign: true }) : '-'}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nobody has joined yet. Sign in and claim first place.</div>'}</div>`;
}

// ------------------------------------------------------------ portfolio
function renderPortfolio() {
  if (!S.me) { app.innerHTML = `<div class="empty"><p style="margin-bottom:14px">Sign in to see your bets.</p><button class="btn primary" data-action="login">Sign in</button></div>`; return; }
  const me = S.me; const u = me.user;
  const open = me.positions.filter((p) => !p.settled);
  const done = me.positions.filter((p) => p.settled);
  const invested = open.reduce((a, p) => a + p.value, 0);
  const posCard = (p) => `<div class="pos-card" data-open="${p.marketId}">
    <div><div class="ttl">${esc(p.marketTitle)}</div><div class="small muted">${p.settled ? (p.status === 'voided' ? 'Voided, refunded' : `Resolved: ${esc(p.resolvedOutcomeName)}`) : p.status === 'closed' ? 'Closed, awaiting result' : 'Open'}</div></div>
    <div class="pnl ${pnlCls(p.pnl)}">${money(p.pnl, { sign: true })}<small>${p.settled ? 'final' : `worth ${money(p.value)}`}</small></div>
    <div class="lines">${p.outcomes.map((o) => `<div class="ln"><span><span class="dot" style="background:${o.color}"></span> ${esc(o.name)}${p.settled && p.resolvedOutcomeId === o.id ? ' 🏆' : ''}</span><span class="num">${o.shares.toFixed(2)} sh${p.settled ? '' : ` @ ${cents(o.price)}`}</span></div>`).join('')}
    <div class="ln muted"><span>Net cost</span><span class="num">${money(p.invested)}</span></div></div></div>`;
  app.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">${avatar(u, 'lg')}<div><h1>${esc(u.name)}</h1><div class="muted">${me.rank ? `Rank #${me.rank} of ${me.players}` : ''}</div></div></div>
    <div class="tiles">
      <div class="tile"><div class="lbl">Net worth</div><div class="val">${money(me.netWorth)}</div><div class="sub ${pnlCls(me.pnl)}">${money(me.pnl, { sign: true })} all-time</div></div>
      <div class="tile"><div class="lbl">Cash</div><div class="val">${money(u.balance)}</div><div class="sub">ready to bet</div></div>
      <div class="tile"><div class="lbl">In open bets</div><div class="val">${money(invested)}</div><div class="sub">${open.length} position${open.length === 1 ? '' : 's'}</div></div>
      <div class="tile"><div class="lbl">Best call</div><div class="val ${u.biggestWin > 0 ? 'up' : ''}">${u.biggestWin > 0 ? money(u.biggestWin, { sign: true }) : '-'}</div><div class="sub">${u.wins} winning market${u.wins === 1 ? '' : 's'}</div></div>
    </div>
    <div class="section-head"><h2>Open positions</h2></div>
    ${open.length ? open.map(posCard).join('') : '<div class="card empty">No open bets. <a class="link" href="#/">Find a market</a></div>'}
    ${done.length ? `<div class="section-head"><h2>Settled</h2></div>${done.map(posCard).join('')}` : ''}`;
}

// ------------------------------------------------------------ activity
function feedLine(f) {
  const mk = f.marketId ? `<a class="link" href="#/m/${f.marketId}">${esc(f.marketTitle)}</a>` : '';
  let ic = '•', body = '';
  if (f.kind === 'trade') { ic = f.side === 'buy' ? '💸' : '💰'; body = `<b>${esc(f.user?.name)}</b> ${f.side === 'buy' ? 'bet' : 'cashed out'} ${money(f.cost)} ${f.side === 'buy' ? 'on' : 'from'} <b style="color:${f.outcomeColor}">${esc(f.outcomeName)}</b> <span class="muted">@ ${cents(f.price)}</span><span class="mk">${mk}</span>`; }
  else if (f.kind === 'new_market') { ic = '🆕'; body = f.user ? `<b>${esc(f.user.name)}</b> created a market: ${mk}` : `New market: ${mk}`; }
  else if (f.kind === 'flag') { ic = '⚠️'; body = `<b>${esc(f.user?.name)}</b> reported a problem with ${mk}<span class="mk">“${esc(f.note)}”</span>`; }
  else if (f.kind === 'unresolved') { ic = '↩️'; body = `Admins undid the result of ${mk}. Payouts were reversed.`; }
  else if (f.kind === 'resolved') { ic = '🏁'; body = `${mk} resolved to <b style="color:${f.outcomeColor}">${esc(f.outcomeName)}</b>`; }
  else if (f.kind === 'voided') { ic = '🚫'; body = `${mk} was voided and refunded`; }
  else if (f.kind === 'joined') { ic = '👋'; body = `<b>${esc(f.user?.name)}</b> joined with ${money(f.amount, { dp: 0 })}`; }
  else if (f.kind === 'credit') { ic = f.amount > 0 ? '🎁' : '🧾'; body = `<b>${esc(f.user?.name)}</b> ${f.amount > 0 ? 'was gifted' : 'was docked'} ${money(Math.abs(f.amount))}${f.note ? ` <span class="muted">(${esc(f.note)})</span>` : ''}`; }
  return `<div class="feed-item"><span class="ic">${ic}</span><div class="body">${body}</div><span class="when">${ago(f.t)}</span></div>`;
}
function renderActivity() {
  app.innerHTML = `<div class="section-head" style="margin-top:0"><h2>Live activity</h2><span class="muted small">Every bet, new market and payout, as it happens</span></div>
    <div class="card"><div class="feed">${S.feed.length ? S.feed.map(feedLine).join('') : '<div class="empty">Quiet so far.</div>'}</div></div>`;
}

// ------------------------------------------------------------ admin
const TEMPLATES = [
  { label: '🍕 Food arrives by…', title: 'Will the food arrive before 9:00 PM?', category: 'Food', type: 'binary', live: true, hours: 2, description: 'Yes if the food is physically here before the stated time.' },
  { label: '🥡 What\'s the next meal?', title: 'What is the next meal going to be?', category: 'Food', outcomes: 'Pizza\nBurgers\nBurritos\nSushi\nSomething else', live: true, hours: 2 },
  { label: '😴 First to nap', title: 'Who will be the first to leave the building for a nap?', category: 'People', outcomes: 'Name 1\nName 2\nName 3\nNobody', hours: 10 },
  { label: '☕ Coffee count', title: 'How many coffees will the winning team drink?', category: 'Chaos', outcomes: '0-5\n6-10\n11-20\n21+', hours: 24 },
  { label: '🔥 Demo fails', title: 'Will a demo crash on stage?', category: 'Chaos', type: 'binary', hours: 24 },
  { label: '🏆 Category winner', title: 'Who wins Best Use of AI?', category: 'Teams', outcomes: 'Team A\nTeam B\nTeam C', hours: 30 },
];

async function renderAdmin() {
  if (!S.me) { app.innerHTML = `<div class="empty"><p style="margin-bottom:14px">Sign in first, then unlock admin with the password.</p><button class="btn primary" data-action="login">Sign in</button></div>`; return; }
  if (!S.me.user.isAdmin) {
    app.innerHTML = `<div class="card" style="max-width:460px;margin:30px auto"><h2>Admin unlock</h2><p class="muted" style="margin-bottom:14px">Admins create markets, call results, and set the prize. The password is printed in the server console when it starts.</p>
      <form id="adminLogin" style="display:flex;gap:8px"><input type="password" name="password" placeholder="Admin password" required autocomplete="off"><button class="btn primary">Unlock</button></form></div>`;
    $('#adminLogin').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('/api/admin/login', { body: { password: e.target.password.value } }); S.me = r.me; toast('Admin mode unlocked.'); renderAdmin(); }
      catch (ex) { toast(esc(ex.message), 'err'); }
    });
    return;
  }
  const tabs = [['markets', 'Markets'], ['players', 'Players'], ['ideas', 'Suggestions'], ['settings', 'Prize & settings']];
  if (S.adminTab === 'create') S.adminTab = 'markets';
  app.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px"><h1>Admin</h1><a class="btn primary sm" href="#/create">+ New market</a></div><div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${S.adminTab === k}" class="${S.adminTab === k ? 'active' : ''}" data-atab="${k}">${l}</button>`).join('')}</div><div id="adminBody"></div>`;
  renderAdminBody();
}

async function renderAdminBody() {
  const body = $('#adminBody'); if (!body) return;
  const t = S.adminTab;
  if (t === 'markets') {
    const ord = { open: 1, closed: 0, resolved: 2, voided: 3 };
    const ms = [...S.markets.values()].sort((a, b) => ((b.flags?.length && b.status !== 'voided') - (a.flags?.length && a.status !== 'voided')) || (ord[a.status] - ord[b.status]) || b.createdAt - a.createdAt);
    body.innerHTML = `<p class="muted small" style="margin-bottom:10px">Admins have the final say. Close a market when the answer becomes obvious, then resolve it to pay out. Got it wrong? Undo the result and resolve again. Anything fishy? Void refunds everyone as if no bets happened. Reported markets float to the top.</p><div class="card" style="padding:4px 16px">${ms.map((m) => `
      <div class="admin-row">
        <div><div class="ttl">${statusPill(m)} ${m.live ? '<span class="pill">live</span>' : ''} ${m.featured ? '<span class="pill">featured</span>' : ''} <a href="#/m/${m.id}">${esc(m.title)}</a></div>
          <div class="sub">${m.createdBy ? `by ${esc(m.createdBy.name)} · ` : ''}${esc(m.category)} · ${money(m.volume, { dp: 0 })} vol · ${m.tradeCount} trades · liquidity ${m.b}${m.closesAt ? ` · closes ${fmtTime(m.closesAt)}` : ''}</div></div>
        <div class="acts">
          <button class="btn sm" data-aedit="${m.id}">Edit</button>
          ${m.status === 'open' ? `<button class="btn sm" data-aclose="${m.id}">Close now</button>` : ''}
          ${m.status === 'closed' ? `<button class="btn sm" data-areopen="${m.id}">Reopen</button>` : ''}
          ${m.status === 'resolved' || m.status === 'voided' ? `<button class="btn sm" data-aunresolve="${m.id}">Undo result</button>` : ''}
          ${m.status !== 'voided' ? `<button class="btn sm danger" data-avoid="${m.id}">Void</button>` : ''}
          <button class="btn sm danger" data-adel="${m.id}" title="Delete market and refund open stakes">Delete</button>
        </div>
        ${m.flags?.length ? `<div class="flagbox"><div class="hd"><span>⚠️ ${m.flags.length} report${m.flags.length === 1 ? '' : 's'}</span><button class="btn sm" data-aclearflags="${m.id}">Clear</button></div>${m.flags.map((f) => `<div><b>${esc(f.user?.name)}</b>: ${esc(f.reason)} <span class="muted">${ago(f.t)}</span></div>`).join('')}</div>` : ''}
        ${m.status === 'open' || m.status === 'closed' ? `<div class="resolve"><span class="small muted">Winner:</span><select data-rsel="${m.id}">${m.outcomes.map((o) => `<option value="${o.id}">${esc(o.name)} (${pct(o.price)})</option>`).join('')}</select><button class="btn sm primary" data-aresolve="${m.id}">Resolve &amp; pay out</button></div>` : ''}
      </div>`).join('') || '<div class="empty">No markets yet.</div>'}</div>`;
  } else if (t === 'players' || t === 'ideas') {
    body.innerHTML = '<div class="empty">Loading…</div>';
    try { S.adminData = await api('/api/admin/overview'); } catch (ex) { body.innerHTML = `<div class="empty">${esc(ex.message)}</div>`; return; }
    if (S.adminTab !== t) return;
    if (t === 'players') {
      const users = S.adminData.users;
      body.innerHTML = `<p class="muted small" style="margin-bottom:10px">Gift or dock play money (bonus for best costume, penalty for breaking the build…). Gifts count as deposits, so they don't inflate P&amp;L.</p><div class="card" style="padding:6px 8px"><div class="table-wrap"><table><thead><tr><th>Player</th><th class="num">Cash</th><th class="num">Net worth</th><th class="num">Trades</th><th>Adjust balance</th><th>Admin</th></tr></thead><tbody>
        ${users.map((u) => `<tr><td><span class="who">${avatar(u)}${esc(u.name)}${u.bot ? ' <span class="pill">bot</span>' : ''}</span></td><td class="num">${money(u.balance)}</td><td class="num">${money(u.netWorth)}</td><td class="num">${u.tradeCount}</td>
          <td><form class="inline-form" data-credit="${u.id}"><input type="number" name="amount" step="any" placeholder="±100"><input name="reason" placeholder="reason" style="width:140px"><button class="btn sm">Apply</button></form></td>
          <td>${u.bot ? '' : `<label class="row small"><input type="checkbox" data-mkadmin="${u.id}" ${u.isAdmin ? 'checked' : ''} ${u.id === S.me.user.id ? 'disabled' : ''}> admin</label>`}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    } else {
      const sg = S.adminData.suggestions;
      body.innerHTML = `<div class="card" style="padding:4px 16px">${sg.length ? sg.map((s) => `<div class="admin-row"><div><div class="ttl" style="${s.status !== 'new' ? 'opacity:.55' : ''}">${esc(s.text)}</div><div class="sub">${esc(s.user?.name || '?')} · ${ago(s.t)} · ${s.status}</div></div>
        <div class="acts">${s.status === 'new' ? `<button class="btn sm primary" data-sgmake="${s.id}">Make market</button><button class="btn sm" data-sgdone="${s.id}">Dismiss</button>` : `<button class="btn sm" data-sgnew="${s.id}">Restore</button>`}</div></div>`).join('') : '<div class="empty">No suggestions yet. Players can send them from the footer link.</div>'}</div>`;
    }
  } else if (t === 'settings') {
    const s = S.settings;
    body.innerHTML = `<form class="card" id="settingsForm"><div class="form-grid">
      <label>Event name<input name="eventName" value="${esc(s.eventName)}" maxlength="60"></label>
      <label>Currency symbol<input name="currency" value="${esc(s.currency)}" maxlength="4"><span class="help">e.g. $, 🪙, HB</span></label>
      <label class="span">Tagline<input name="tagline" value="${esc(s.tagline)}" maxlength="120"></label>
      <label class="span">🏆 Prize for 1st place<textarea name="prizeText" rows="3" maxlength="500">${esc(s.prizeText)}</textarea><span class="help">Shown at the top of the leaderboard. Ideas: the golden trophy, first pick of the swag table, the CEO does your standup for a week, a custom Slack emoji of your face, lunch on the organizers.</span></label>
      <label class="row span"><input type="checkbox" name="allowUserMarkets" ${s.allowUserMarkets ? 'checked' : ''}> Let players create their own markets <span class="help">(admins always can; only admins resolve or void)</span></label>
      <label>Starting balance for new players<input name="startingBalance" type="number" min="1" step="1" value="${s.startingBalance}"><span class="help">Only affects players who join after you change it.</span></label>
    </div><div style="margin-top:14px;display:flex;justify-content:flex-end"><button class="btn primary">Save settings</button></div></form>
    <div class="card danger-zone" style="margin-top:16px"><h3>Danger zone</h3><p class="muted small" style="margin-bottom:12px">Use before the real event to clear test data. Settings are kept either way.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn danger" data-reset="markets">Reset markets + balances (keep players)</button><button class="btn danger" data-reset="markets-starter">…and reload starter markets</button><button class="btn danger" data-reset="all">Wipe everything</button></div></div>`;
    $('#settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try { const r = await api('/api/admin/settings', { method: 'PATCH', body: { eventName: f.eventName.value, currency: f.currency.value, tagline: f.tagline.value, prizeText: f.prizeText.value, startingBalance: Number(f.startingBalance.value), allowUserMarkets: f.allowUserMarkets.checked } }); S.settings = r.settings; renderTopbar(); toast('Settings saved.'); }
      catch (ex) { toast(esc(ex.message), 'err'); }
    });
  }
}

function renderCreate() {
  if (!S.me) { app.innerHTML = `<div class="empty"><p style="margin-bottom:14px">Sign in to create a market.</p><button class="btn primary" data-action="login">Sign in</button></div>`; return; }
  const admin = S.me.user.isAdmin;
  if (!canCreate()) {
    app.innerHTML = `<div class="card" style="max-width:520px;margin:30px auto"><h2>Market creation is admin-only right now</h2><p class="muted" style="margin-bottom:14px">Send your idea to the admins and they can post it.</p><button class="btn primary" data-action="suggest-dialog">Suggest a market</button></div>`;
    return;
  }
  const pre = S.createPrefill || {}; S.createPrefill = null;
  const form = (v) => `${marketFormFields(v, { admin })}<p class="form-error" id="createErr" hidden></p><div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end"><button class="btn primary">Create market</button></div>`;
  app.innerHTML = `<h1>Create a market</h1>
    <p class="muted create-intro">Anyone can post a bet. Admins call the result and have the final say, and they'll void it if anything is off, so write rules that make the answer obvious.</p>
    <div class="templates"><span class="small muted" style="align-self:center">Quick templates:</span>${TEMPLATES.map((tp, i) => `<button data-tpl="${i}">${tp.label}</button>`).join('')}</div>
    <form class="card" id="createForm">${form({ type: 'binary', b: 150, hours: 3, ...pre })}</form>`;
  const f = $('#createForm');
  wireMarketForm(f);
  if (pre.title) f.title.focus();
  app.querySelector('.templates').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tpl]'); if (!b) return;
    const tp = TEMPLATES[Number(b.dataset.tpl)];
    f.innerHTML = form({ ...tp, type: tp.type || 'multi', b: 150 });
    wireMarketForm(f);
    f.title.focus(); f.title.select();
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#createErr'); err.hidden = true;
    const btn = f.querySelector('button.primary'); btn.disabled = true;
    try {
      const r = await api('/api/markets', { body: readMarketForm(f) });
      S.markets.set(r.market.id, r.market);
      toast(`Market created: <b>${esc(r.market.title)}</b>`);
      location.hash = `#/m/${r.market.id}`;
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  });
}

function marketFormFields(v, opts = {}) {
  const outcomes = Array.isArray(v.outcomes) ? v.outcomes.join('\n') : v.outcomes || '';
  const isBinary = v.type === 'binary';
  return `<div class="form-grid">
    <label class="span">Question<input name="title" required maxlength="140" value="${esc(v.title || '')}" placeholder="Will the pizza be here before 8pm?"></label>
    <label>Type<select name="type"><option value="binary" ${isBinary ? 'selected' : ''}>Yes / No</option><option value="multi" ${!isBinary ? 'selected' : ''}>Multiple choice</option></select></label>
    <label>Category<input name="category" list="catList" value="${esc(v.category || 'General')}" maxlength="30"><datalist id="catList">${[...new Set(['Teams', 'Food', 'People', 'Chaos', ...[...S.markets.values()].map((m) => m.category)])].map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
    <label class="span" data-outcomes ${isBinary ? 'hidden' : ''}>Outcomes (one per line, 2-12)<textarea name="outcomes" rows="5" placeholder="Team A\nTeam B\nTeam C">${esc(outcomes)}</textarea></label>
    <label>Trading closes<input name="closesAt" type="datetime-local" value="${toLocalInput(v.closesAt || (v.hours ? Date.now() + v.hours * 3600e3 : null))}"><span class="help">Leave empty to keep it open until you close it.</span></label>
    ${opts.admin ? `<label>Liquidity (b)<input name="b" type="number" min="20" max="2000" step="10" value="${v.b ?? 150}"><span class="help">Lower = prices swing harder per bet. 100-200 suits a room of ~30.</span></label>` : ''}
    <label class="span">Rules / how it resolves<textarea name="description" rows="3" maxlength="2000" placeholder="Resolves Yes if…">${esc(v.description || '')}</textarea></label>
    <label class="row"><input type="checkbox" name="live" ${v.live ? 'checked' : ''}> 🔴 Live event (shows in "Happening now")</label>
    ${opts.admin ? `<label class="row"><input type="checkbox" name="featured" ${v.featured ? 'checked' : ''}> ⭐ Featured on the home page</label>` : ''}
  </div>`;
}
function wireMarketForm(form) {
  form.type.addEventListener('change', () => { form.querySelector('[data-outcomes]').hidden = form.type.value === 'binary'; });
}
function readMarketForm(f) {
  return {
    title: f.title.value, type: f.type.value, category: f.category.value, description: f.description.value,
    outcomes: f.type.value === 'binary' ? ['Yes', 'No'] : f.outcomes.value.split('\n').map((s) => s.trim()).filter(Boolean),
    closesAt: fromLocalInput(f.closesAt.value), b: f.b ? Number(f.b.value) : undefined, live: f.live.checked, featured: f.featured ? f.featured.checked : undefined,
  };
}

app.addEventListener('click', async (e) => {
  if (!['admin', 'm'].includes(route().name)) return;
  const d = (k) => e.target.closest(`[data-${k}]`)?.dataset[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
  const run = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); } catch (ex) { toast(esc(ex.message), 'err'); } };
  let v;
  if ((v = d('atab'))) { S.adminTab = v; renderAdmin(); return; }
  if ((v = d('aclose'))) return run(async () => { await api(`/api/admin/markets/${v}/close`, { method: 'POST' }); }, 'Trading closed.');
  if ((v = d('areopen'))) return run(async () => { await api(`/api/admin/markets/${v}/reopen`, { body: {} }); }, 'Market reopened with no close time.');
  if ((v = d('aresolve'))) {
    const m = S.markets.get(v); const sel = $(`[data-rsel="${v}"]`);
    const o = m.outcomes.find((x) => x.id === sel.value);
    if (!confirm(`Resolve "${m.title}" to "${o.name}"?\n\nEveryone holding ${o.name} gets ${cur()}1 per share. This can't be undone.`)) return;
    return run(async () => { await api(`/api/admin/markets/${v}/resolve`, { body: { outcomeId: o.id } }); }, `Resolved to <b>${esc(o.name)}</b>. Payouts sent.`);
  }
  if ((v = d('avoid'))) { if (!confirm('Void this market?\n\nEvery bet is undone as if it never happened and everyone gets their net stake back. If it was already resolved, the payouts are reversed first.')) return; return run(async () => { await api(`/api/admin/markets/${v}/void`, { method: 'POST' }); }, 'Market voided and refunded.'); }
  if ((v = d('aunresolve'))) { if (!confirm('Undo the result?\n\nPayouts or refunds are taken back and the market goes back to closed, so you can resolve it again. Balances can dip below zero if someone already spent their winnings.')) return; return run(async () => { await api(`/api/admin/markets/${v}/unresolve`, { method: 'POST' }); }, 'Result undone. Resolve it again or void it.'); }
  if ((v = d('aclearflags'))) return run(async () => { await api(`/api/admin/markets/${v}/clear-flags`, { method: 'POST' }); }, 'Reports cleared.');
  if ((v = d('adel'))) { if (!confirm('Delete this market completely? Open stakes are refunded first. Settled payouts stay where they are.')) return; return run(async () => { await api(`/api/admin/markets/${v}`, { method: 'DELETE' }); }, 'Market deleted.'); }
  if ((v = d('aedit'))) return openEdit(v);
  if ((v = d('sgmake'))) {
    const s = S.adminData.suggestions.find((x) => x.id === v);
    await api(`/api/admin/suggestions/${v}`, { method: 'PATCH', body: { status: 'done' } });
    S.createPrefill = { title: s.text.slice(0, 140) };
    location.hash = '#/create';
    return;
  }
  if ((v = d('sgdone'))) return run(async () => { await api(`/api/admin/suggestions/${v}`, { method: 'PATCH', body: { status: 'dismissed' } }); renderAdminBody(); });
  if ((v = d('sgnew'))) return run(async () => { await api(`/api/admin/suggestions/${v}`, { method: 'PATCH', body: { status: 'new' } }); renderAdminBody(); });
  if ((v = d('reset'))) {
    const msg = { markets: 'Delete ALL markets and trades and reset every player to the starting balance?', 'markets-starter': 'Delete ALL markets and trades, reset balances, and reload the starter markets?', all: 'Wipe EVERYTHING, including all players? Everyone will need to sign up again.' }[v];
    if (!confirm(msg) || !confirm('Really? This cannot be undone.')) return;
    return run(async () => { await api('/api/admin/reset', { body: { mode: v === 'all' ? 'all' : 'markets', starter: v === 'markets-starter' } }); });
  }
});
app.addEventListener('change', async (e) => {
  const cb = e.target.closest('[data-mkadmin]');
  if (cb) { try { await api(`/api/admin/users/${cb.dataset.mkadmin}/admin`, { body: { isAdmin: cb.checked } }); toast('Updated.'); } catch (ex) { toast(esc(ex.message), 'err'); } }
});
app.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-credit]');
  if (!f) return;
  e.preventDefault();
  try { await api(`/api/admin/users/${f.dataset.credit}/credit`, { body: { amount: Number(f.amount.value), reason: f.reason.value } }); toast('Balance updated.'); renderAdminBody(); }
  catch (ex) { toast(esc(ex.message), 'err'); }
});

async function openEdit(id) {
  const { market: m } = await api(`/api/markets/${id}`);
  $('#editTitle').textContent = 'Edit market';
  $('#editFields').innerHTML = marketFormFields({ ...m, type: m.binary ? 'binary' : 'multi', outcomes: m.outcomes.map((o) => o.name) }, { admin: true }) +
    (m.tradeCount ? '<p class="help" style="margin-top:10px">Trading has started, so you can rename outcomes but not add or remove them, and liquidity is locked.</p>' : '');
  const form = $('#editForm');
  form.dataset.id = id;
  wireMarketForm(form);
  if (m.tradeCount) { form.type.disabled = true; form.b.disabled = true; }
  $('#editError').hidden = true;
  openDialog('editDialog');
}
$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const body = readMarketForm(f);
  if (f.b.disabled) delete body.b;
  try {
    const r = await api(`/api/admin/markets/${f.dataset.id}`, { method: 'PATCH', body });
    S.markets.set(r.market.id, r.market);
    $('#editDialog').close(); toast('Market updated.'); render();
  } catch (ex) { $('#editError').textContent = ex.message; $('#editError').hidden = false; }
});

// ------------------------------------------------------------ live updates (SSE)
let refreshTimer = null;
function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    try {
      const [lb, fd, me] = await Promise.all([api('/api/leaderboard'), api('/api/feed'), S.me ? api('/api/me') : Promise.resolve(null)]);
      S.leaderboard = lb.leaderboard; S.feed = fd.feed;
      if (me) S.me = me.me;
      renderTopbar();
      const r = route().name;
      if (r === 'leaderboard') renderLeaderboard();
      else if (r === 'activity') renderActivity();
      else if (r === 'portfolio') renderPortfolio();
      else if (r === 'm' && S.detail) { renderPositionBox(); }
    } catch { /* offline blip */ }
  }, 350);
}

function onMarket(mv, isNew) {
  const prev = S.markets.get(mv.id);
  S.markets.set(mv.id, mv);
  const r = route();
  if (isNew && mv.status === 'open' && mv.createdBy?.id !== S.me?.user.id) toast(`🆕 ${mv.createdBy ? `<b>${esc(mv.createdBy.name)}</b> created` : 'New market'}: <a class="link" href="#/m/${mv.id}">${esc(mv.title)}</a>`, 'ok', 6000);
  if (r.name === 'markets') {
    const el = document.getElementById(`mc-${mv.id}`);
    if (el && prev && prev.status === mv.status) {
      const tmp = document.createElement('div'); tmp.innerHTML = marketCard(mv);
      const nu = tmp.firstElementChild;
      const lead = (x) => (x.binary ? x.outcomes[0].price : Math.max(...x.outcomes.map((o) => o.price)));
      const d = lead(mv) - lead(prev);
      if (Math.abs(d) > 0.001) nu.classList.add(d > 0 ? 'flash-up' : 'flash-down');
      el.replaceWith(nu);
    } else renderMarkets();
  } else if (r.name === 'm' && r.id === mv.id && S.detail) {
    // pull detail (history + trades) again, keeping the user's in-progress input
    api(`/api/markets/${mv.id}`).then((d) => {
      if (route().id !== mv.id) return;
      S.detail = d;
      const active = document.activeElement?.id === 'amt';
      renderMarket(mv.id);
      if (active) { const n = $('#amt'); n?.focus(); }
    }).catch(() => {});
  } else if (r.name === 'admin' && S.adminTab === 'markets') renderAdminBody();
  renderTicker();
}

function connectStream() {
  const es = new EventSource('/api/stream');
  es.onmessage = (e) => {
    let ev; try { ev = JSON.parse(e.data); } catch { return; }
    if (ev.type === 'market') onMarket(ev.market, ev.isNew);
    else if (ev.type === 'market_deleted') { S.markets.delete(ev.marketId); if (route().id === ev.marketId) location.hash = '#/'; else render(); renderTicker(); }
    else if (ev.type === 'trade') {
      S.feed.unshift(ev.trade); S.feed = S.feed.slice(0, 120);
      if (ev.trade.user?.id !== S.me?.user.id && route().name === 'markets' && ev.trade.cost >= 50) toast(`${esc(ev.trade.user?.name)} just bet ${money(ev.trade.cost, { dp: 0 })} on <b>${esc(ev.trade.outcomeName)}</b>`, 'ok', 3000);
      scheduleRefresh();
    }
    else if (ev.type === 'settled') {
      toast(ev.undone ? `↩️ Result undone: <b>${esc(ev.title)}</b>. Payouts reversed.` : ev.voided ? `🚫 Voided: ${esc(ev.title)}` : `🏁 <b>${esc(ev.title)}</b> resolved: <b>${esc(ev.outcomeName)}</b>`, 'ok', 7000);
      scheduleRefresh();
    }
    else if (ev.type === 'leaderboard' || ev.type === 'feed' || ev.type === 'balance') scheduleRefresh();
    else if (ev.type === 'settings') { S.settings = ev.settings; renderTopbar(); if (['leaderboard', 'markets'].includes(route().name)) render(); }
    else if (ev.type === 'flag') { if (S.me?.user.isAdmin) toast(`⚠️ <b>${esc(ev.user?.name)}</b> reported <a class="link" href="#/m/${ev.marketId}">${esc(ev.title)}</a>: ${esc(ev.reason)}`, 'err', 9000); }
    else if (ev.type === 'suggestion') { if (route().name === 'admin' && S.adminTab === 'ideas') renderAdminBody(); }
    else if (ev.type === 'reload') location.reload();
  };
}

// keep relative times and countdowns fresh
setInterval(() => {
  const r = route().name;
  if (r === 'markets' && document.activeElement?.id !== 'search') renderMarkets();
  if (r === 'activity') renderActivity();
}, 30000);

// ------------------------------------------------------------ boot
(async function boot() {
  try {
    const b = await api('/api/bootstrap');
    S.me = b.me; S.settings = b.settings; S.feed = b.feed; S.leaderboard = b.leaderboard; S.demo = b.demo;
    b.markets.forEach((m) => S.markets.set(m.id, m));
  } catch (e) {
    app.innerHTML = `<div class="empty">Couldn't reach the server: ${esc(e.message)}</div>`; return;
  }
  renderTopbar(); renderTicker(); render();
  connectStream();
})();
})();
