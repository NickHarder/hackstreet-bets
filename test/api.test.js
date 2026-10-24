// End-to-end API tests against a real server process with a throwaway data dir.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, player } from './helpers.js';

let server; let base;
before(async () => { server = await startServer(); base = server.url; });
after(async () => { await server?.stop(); });

const cents = (x) => Math.round(x * 100);
const openBinary = async (creator, title) => {
  const r = await creator.post('/api/markets', { title, type: 'binary', closesAt: Date.now() + 3600e3 });
  assert.equal(r.status, 200, r.error);
  return r.market;
};

describe('accounts', () => {
  test('a new handle gets the starting balance', async () => {
    const c = new Client(base);
    const r = await c.signIn('alice');
    assert.equal(r.status, 200);
    assert.equal(r.created, true);
    assert.equal(r.me.user.balance, 1000);
  });

  test('returning players sign in with their PIN, wrong PIN is rejected', async () => {
    await player(base, 'bob');
    const again = new Client(base);
    assert.equal((await again.signIn('BOB')).status, 200, 'names are case-insensitive');
    assert.equal((await new Client(base).signIn('bob', '9999')).status, 401);
  });

  test('bad names and short PINs are rejected', async () => {
    assert.equal((await new Client(base).signIn('x')).status, 400);
    assert.equal((await new Client(base).signIn('<script>')).status, 400);
    assert.equal((await new Client(base).signIn('validname', '12')).status, 400);
  });

  test('signing out ends the session', async () => {
    const c = await player(base, 'leaver');
    await c.post('/api/logout');
    assert.equal((await c.get('/api/me')).me, null);
  });
});

describe('trading', () => {
  test('buying spends exactly the stake, buys >1 share per dollar, and moves the price', async () => {
    const c = await player(base, 'trader1');
    const m = await openBinary(c, 'Trading test: will it work?');
    const yes = m.outcomes[0];
    const r = await c.post(`/api/markets/${m.id}/trade`, { outcomeId: yes.id, side: 'buy', amount: 100 });
    assert.equal(r.status, 200, r.error);
    assert.equal(r.me.user.balance, 900);
    assert.ok(r.trade.shares > 100);
    const after = r.market.outcomes;
    assert.ok(after[0].price > 0.5 && after[1].price < 0.5);
    assert.ok(Math.abs(after[0].price + after[1].price - 1) < 1e-9);
  });

  test('overspending, tiny bets, and overselling are rejected', async () => {
    const c = await player(base, 'trader2');
    const m = await openBinary(c, 'Trading test: limits');
    const [y] = m.outcomes;
    assert.equal((await c.post(`/api/markets/${m.id}/trade`, { outcomeId: y.id, side: 'buy', amount: 5000 })).status, 400);
    assert.equal((await c.post(`/api/markets/${m.id}/trade`, { outcomeId: y.id, side: 'buy', amount: 0.5 })).status, 400);
    assert.equal((await c.post(`/api/markets/${m.id}/trade`, { outcomeId: y.id, side: 'sell', shares: 1 })).status, 400);
    assert.equal((await c.post(`/api/markets/${m.id}/trade`, { outcomeId: 'nope', side: 'buy', amount: 5 })).status, 400);
    assert.equal(await c.balance(), 1000, 'failed trades must not touch the balance');
  });

  test('buy then sell everything gives back the stake (no free money)', async () => {
    const c = await player(base, 'trader3');
    const m = await openBinary(c, 'Trading test: round trip');
    const [y] = m.outcomes;
    const b = await c.post(`/api/markets/${m.id}/trade`, { outcomeId: y.id, side: 'buy', amount: 80 });
    const s = await c.post(`/api/markets/${m.id}/trade`, { outcomeId: y.id, side: 'sell', shares: b.trade.shares });
    assert.equal(s.status, 200, s.error);
    assert.ok(Math.abs(s.me.user.balance - 1000) <= 0.01, `balance ${s.me.user.balance}`);
  });

  test('signed-out users cannot trade', async () => {
    const owner = await player(base, 'trader4');
    const m = await openBinary(owner, 'Trading test: signed out');
    assert.equal((await new Client(base).post(`/api/markets/${m.id}/trade`, { outcomeId: m.outcomes[0].id, side: 'buy', amount: 5 })).status, 401);
  });
});

describe('player-created markets', () => {
  test('players can create markets but not set admin-only options', async () => {
    const c = await player(base, 'creator1');
    const r = await c.post('/api/markets', { title: 'Creator test: featured?', type: 'multi', outcomes: ['A', 'B', 'C'], featured: true, b: 20 });
    assert.equal(r.status, 200, r.error);
    assert.equal(r.market.createdBy.name, 'creator1');
    assert.equal(r.market.featured, false);
    assert.equal(r.market.b, 150);
    assert.equal(r.market.outcomes.length, 3);
  });

  test('validation: duplicate questions, past close times, outcome counts', async () => {
    const c = await player(base, 'creator2');
    await openBinary(c, 'Creator test: unique question');
    assert.equal((await c.post('/api/markets', { title: 'creator test: UNIQUE question', type: 'binary' })).status, 409);
    assert.equal((await c.post('/api/markets', { title: 'Creator test: past', type: 'binary', closesAt: Date.now() - 5000 })).status, 400);
    assert.equal((await c.post('/api/markets', { title: 'Creator test: one outcome', type: 'multi', outcomes: ['Only'] })).status, 400);
    assert.equal((await c.post('/api/markets', { title: 'Creator test: dupes', type: 'multi', outcomes: ['A', 'a'] })).status, 400);
    assert.equal((await c.post('/api/markets', { title: 'x', type: 'binary' })).status, 400);
  });

  test('creators can delete their own market only until someone bets', async () => {
    const owner = await player(base, 'creator3');
    const other = await player(base, 'creator3b');
    const m1 = await openBinary(owner, 'Creator test: delete me');
    assert.equal((await other.del(`/api/markets/${m1.id}`)).status, 403);
    assert.equal((await owner.del(`/api/markets/${m1.id}`)).status, 200);
    const m2 = await openBinary(owner, 'Creator test: cannot delete');
    await other.post(`/api/markets/${m2.id}/trade`, { outcomeId: m2.outcomes[0].id, side: 'buy', amount: 5 });
    assert.equal((await owner.del(`/api/markets/${m2.id}`)).status, 400);
  });

  test('a player can have at most 8 unsettled markets', async () => {
    const c = await player(base, 'spammer');
    for (let i = 0; i < 8; i++) await openBinary(c, `Spam test ${i}`);
    assert.equal((await c.post('/api/markets', { title: 'Spam test 9', type: 'binary' })).status, 429);
  });

  test('admins can switch player-created markets off', async () => {
    const admin = await player(base, 'admin_toggle');
    await admin.makeAdmin();
    const c = await player(base, 'creator4');
    await admin.patch('/api/admin/settings', { allowUserMarkets: false });
    try {
      assert.equal((await c.post('/api/markets', { title: 'Toggle test: player', type: 'binary' })).status, 403);
      assert.equal((await admin.post('/api/markets', { title: 'Toggle test: admin', type: 'binary' })).status, 200);
    } finally {
      await admin.patch('/api/admin/settings', { allowUserMarkets: true });
    }
  });
});

describe('admin powers', () => {
  test('players cannot use admin endpoints; the wrong password is rejected', async () => {
    const c = await player(base, 'notadmin');
    const m = await openBinary(c, 'Admin test: gated');
    assert.equal((await c.post(`/api/admin/markets/${m.id}/resolve`, { outcomeId: m.outcomes[0].id })).status, 403);
    assert.equal((await c.post(`/api/admin/markets/${m.id}/void`)).status, 403);
    assert.equal((await c.post(`/api/admin/markets/${m.id}/unresolve`)).status, 403);
    assert.equal((await c.patch('/api/admin/settings', { prizeText: 'hacked' })).status, 403);
    assert.equal((await c.post('/api/admin/login', { password: 'wrong' })).status, 401);
  });

  test('gifts count as deposits, so they change balance but not P&L', async () => {
    const admin = await player(base, 'admin_gift'); await admin.makeAdmin();
    const c = await player(base, 'giftee');
    const me = (await c.get('/api/me')).me;
    assert.equal((await admin.post(`/api/admin/users/${me.user.id}/credit`, { amount: 250, reason: 'best team name' })).status, 200);
    const after = (await c.get('/api/me')).me;
    assert.equal(after.user.balance, 1250);
    assert.equal(after.pnl, 0);
  });
});

describe('settling markets', () => {
  // alice2 bets Yes, bob2 bets No, bob2 also sells some for a profit. Then the
  // admin resolves, undoes, re-resolves and voids, checking every balance.
  let admin; let yesBettor; let noBettor; let m; let Y; let N; let pre;
  before(async () => {
    admin = await player(base, 'settle_admin'); await admin.makeAdmin();
    yesBettor = await player(base, 'settle_yes');
    noBettor = await player(base, 'settle_no');
    m = await openBinary(yesBettor, 'Settle test: will it rain?');
    [Y, N] = m.outcomes.map((o) => o.id);
    await yesBettor.post(`/api/markets/${m.id}/trade`, { outcomeId: Y, side: 'buy', amount: 100 });
    const nb = await noBettor.post(`/api/markets/${m.id}/trade`, { outcomeId: N, side: 'buy', amount: 60 });
    await yesBettor.post(`/api/markets/${m.id}/trade`, { outcomeId: Y, side: 'buy', amount: 50 });
    await noBettor.post(`/api/markets/${m.id}/trade`, { outcomeId: N, side: 'sell', shares: nb.trade.shares / 3 });
    pre = { yes: await yesBettor.balance(), no: await noBettor.balance() };
  });

  test('closed markets refuse new bets', async () => {
    await admin.post(`/api/admin/markets/${m.id}/close`);
    assert.equal((await yesBettor.post(`/api/markets/${m.id}/trade`, { outcomeId: Y, side: 'buy', amount: 5 })).status, 400);
  });

  test('resolving pays $1 per winning share and nothing to losers', async () => {
    const yesShares = (await yesBettor.get(`/api/markets/${m.id}`)).position.shares[Y];
    assert.equal((await admin.post(`/api/admin/markets/${m.id}/resolve`, { outcomeId: Y })).status, 200);
    assert.equal(cents(await yesBettor.balance()), cents(pre.yes + yesShares));
    assert.equal(await noBettor.balance(), pre.no);
    assert.equal((await admin.post(`/api/admin/markets/${m.id}/resolve`, { outcomeId: N })).status, 400, 'cannot resolve twice');
  });

  test('undo result restores every balance exactly', async () => {
    const r = await admin.post(`/api/admin/markets/${m.id}/unresolve`);
    assert.equal(r.market.status, 'closed');
    assert.equal(await yesBettor.balance(), pre.yes);
    assert.equal(await noBettor.balance(), pre.no);
    const lb = (await yesBettor.get('/api/leaderboard')).leaderboard.find((x) => x.name === 'settle_yes');
    assert.equal(lb.biggestWin, 0, 'stats from the undone result are removed');
  });

  test('re-resolving to the other outcome pays the other side', async () => {
    const noShares = (await noBettor.get(`/api/markets/${m.id}`)).position.shares[N];
    await admin.post(`/api/admin/markets/${m.id}/resolve`, { outcomeId: N });
    assert.equal(cents(await noBettor.balance()), cents(pre.no + noShares));
    assert.equal(await yesBettor.balance(), pre.yes);
  });

  test('voiding (even after resolving) returns everyone to exactly where they started', async () => {
    const r = await admin.post(`/api/admin/markets/${m.id}/void`);
    assert.equal(r.market.status, 'voided');
    assert.equal(await yesBettor.balance(), 1000);
    assert.equal(await noBettor.balance(), 1000);
    assert.equal((await admin.post(`/api/admin/markets/${m.id}/void`)).status, 400, 'cannot void twice');
  });

  test('a voided market can be un-voided back to closed', async () => {
    const r = await admin.post(`/api/admin/markets/${m.id}/unresolve`);
    assert.equal(r.market.status, 'closed');
    assert.equal(await yesBettor.balance(), pre.yes);
    assert.equal(await noBettor.balance(), pre.no);
  });
});

describe('voiding claws back early profits', () => {
  test('someone who sold at a profit before a void ends up exactly where they started', async () => {
    const admin = await player(base, 'claw_admin'); await admin.makeAdmin();
    const early = await player(base, 'claw_early');
    const whale = await player(base, 'claw_whale');
    const m = await openBinary(early, 'Void test: early profit');
    const [Y] = m.outcomes.map((o) => o.id);
    const b = await early.post(`/api/markets/${m.id}/trade`, { outcomeId: Y, side: 'buy', amount: 50 });
    await whale.post(`/api/markets/${m.id}/trade`, { outcomeId: Y, side: 'buy', amount: 400 });
    await early.post(`/api/markets/${m.id}/trade`, { outcomeId: Y, side: 'sell', shares: b.trade.shares });
    assert.ok(await early.balance() > 1000, 'precondition: the early bettor sold at a profit');
    await admin.post(`/api/admin/markets/${m.id}/void`);
    assert.equal(await early.balance(), 1000);
    assert.equal(await whale.balance(), 1000);
  });
});

describe('reports', () => {
  test('reports are visible, one per player, and blocked on voided markets', async () => {
    const admin = await player(base, 'flag_admin'); await admin.makeAdmin();
    const c = await player(base, 'flagger');
    const m = await openBinary(c, 'Flag test: suspicious');
    assert.equal((await c.post(`/api/markets/${m.id}/flag`, { reason: 'x' })).status, 400, 'needs a reason');
    await c.post(`/api/markets/${m.id}/flag`, { reason: 'first reason' });
    await c.post(`/api/markets/${m.id}/flag`, { reason: 'updated reason' });
    const flags = (await new Client(base).get(`/api/markets/${m.id}`)).market.flags;
    assert.deepEqual(flags.map((f) => [f.user.name, f.reason]), [['flagger', 'updated reason']]);
    await admin.post(`/api/admin/markets/${m.id}/void`);
    assert.equal((await c.post(`/api/markets/${m.id}/flag`, { reason: 'too late' })).status, 400);
  });
});

describe('leaderboard and live data', () => {
  test('leaderboard is sorted by net worth and updates right after a bet', async () => {
    const c = await player(base, 'lb_watcher');
    const m = await openBinary(c, 'Leaderboard test: freshness');
    const before = (await c.get('/api/live')).leaderboard;
    for (let i = 1; i < before.length; i++) assert.ok(before[i - 1].netWorth >= before[i].netWorth);
    const mineBefore = before.find((r) => r.name === 'lb_watcher');
    assert.equal(mineBefore.tradeCount, 0);
    await c.post(`/api/markets/${m.id}/trade`, { outcomeId: m.outcomes[0].id, side: 'buy', amount: 200 });
    const live = await c.get('/api/live');
    const mineAfter = live.leaderboard.find((r) => r.name === 'lb_watcher');
    assert.equal(mineAfter.tradeCount, 1, 'cached leaderboard must refresh after a trade');
    assert.equal(mineAfter.cash, 800);
    assert.equal(live.me.user.balance, 800);
    assert.equal(live.feed[0].kind, 'trade');
    assert.equal(live.feed[0].user.name, 'lb_watcher');
  });

  test('the live stream pushes trades to other viewers', async () => {
    const c = await player(base, 'streamer');
    const m = await openBinary(c, 'Stream test: push');
    const ac = new AbortController();
    const res = await fetch(base + '/api/stream', { signal: ac.signal });
    const reader = res.body.getReader();
    const got = (async () => {
      let buf = '';
      for (;;) { const { value, done } = await reader.read(); if (done) return null; buf += new TextDecoder().decode(value); if (buf.includes('"type":"trade"')) return buf; }
    })();
    await c.post(`/api/markets/${m.id}/trade`, { outcomeId: m.outcomes[1].id, side: 'buy', amount: 7 });
    const text = await Promise.race([got, new Promise((r) => setTimeout(() => r(null), 3000))]);
    ac.abort();
    assert.ok(text && text.includes('"streamer"'), 'trade event should arrive over SSE');
  });

  test('when every market is voided, everyone is back to exactly what they deposited', async () => {
    const admin = await player(base, 'final_admin'); await admin.makeAdmin();
    const { markets } = await admin.get('/api/markets');
    for (const m of markets) if (m.status !== 'voided') assert.equal((await admin.post(`/api/admin/markets/${m.id}/void`)).status, 200);
    const { users } = await admin.get('/api/admin/overview');
    for (const u of users) assert.equal(cents(u.balance), cents(u.deposited), `${u.name}: ${u.balance} vs ${u.deposited}`);
  });
});

describe('server lifecycle', () => {
  test('data survives a restart', async () => {
    const s1 = await startServer();
    const c = await player(s1.url, 'survivor');
    const m = await openBinary(c, 'Restart test: persists');
    await c.post(`/api/markets/${m.id}/trade`, { outcomeId: m.outcomes[0].id, side: 'buy', amount: 123 });
    await s1.stop();
    const s2 = await startServer({ dataDir: s1.dataDir });
    try {
      const again = await player(s2.url, 'survivor');
      assert.equal(await again.balance(), 877);
      const detail = await again.get(`/api/markets/${m.id}`);
      assert.equal(detail.market.tradeCount, 1);
    } finally { await s2.stop(); }
  });

  test('starting a second copy on a busy port fails loudly instead of pretending', async () => {
    const dup = await startServer({ port: server.port, expectFailure: true });
    const code = await Promise.race([dup.exited, new Promise((r) => setTimeout(() => r('still running'), 5000))]);
    await dup.stop();
    assert.equal(code, 1);
    assert.match(dup.output(), /already in use/);
    assert.doesNotMatch(dup.output(), /is up/);
  });
});
