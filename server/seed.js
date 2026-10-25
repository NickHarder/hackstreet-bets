// Starter markets (always on first run) and optional demo data (DEMO=1).
export const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767', '#5fb0ff', '#f0a070', '#49c9a0', '#e9c05e'];

const H = 3600e3;
const M = 60e3;

// Starter markets follow the night's timeline. Close times are anchored to the
// event schedule in settings, so deploying days early doesn't close them early.
// If an anchored time has already passed (e.g. reusing the app later), the
// market falls back to the same offset from now.
export function starterPack(ctx) {
  const now = Date.now();
  const { eventStart, eventEnd } = ctx.db.settings;
  const fromStart = (h) => { const t = eventStart + h * H; return t > now + 30 * M ? t : now + Math.max(h, 1) * H; };
  const beforeEnd = (h) => { const t = eventEnd - h * H; return t > now + 30 * M ? t : now + 24 * H - h * H; };

  ctx.createMarket({
    title: 'Which team wins the hackathon?',
    description: 'Resolves to the team the judges announce as the overall winner on Saturday. Rename these placeholder teams in the Admin panel once squads are formed.',
    category: 'Teams',
    outcomes: ['Null Pointers', 'Ctrl+Alt+Defeat', 'The Merge Conflicts', '404 Team Not Found', 'Segfault Squad', 'Rubber Duck Debuggers'],
    b: 200,
    closesAt: beforeEnd(1),
    featured: true,
  });
  ctx.createMarket({
    title: 'Champions or Challengers: whose team takes first place?',
    description: 'The Return vs. The Rise. Resolves to the side the overall winning team belongs to. If the winning team has both, admins call it by majority.',
    category: 'Teams',
    outcomes: ['Champions (The Return)', 'Challengers (The Rise)'],
    colors: ['#d9a54e', '#c9ccd1'],
    b: 200,
    closesAt: beforeEnd(1),
  });
  ctx.createMarket({
    title: 'Will the kickoff happy hour run dry before 7:00 PM Friday?',
    description: 'Yes if there is nothing left to pour (beer, wine, seltzer, the weird flavored one) before 7:00 PM. Water does not count.',
    category: 'Food',
    outcomes: ['Yes', 'No'],
    b: 120,
    closesAt: fromStart(1.5),
    live: true,
  });
  ctx.createMarket({
    title: "What's for dinner Friday?",
    description: 'Resolves to the cuisine that actually shows up. If it is a mix, the one with the most boxes wins.',
    category: 'Food',
    outcomes: ['Pizza', 'Tacos', 'BBQ', 'Sushi', 'Thai', 'Something else'],
    b: 120,
    closesAt: fromStart(1.5),
    live: true,
  });
  ctx.createMarket({
    title: 'Will dinner arrive before 7:30 PM Friday?',
    description: 'Yes if the food is on the table before 7:30 PM by the venue clock. Admin is the referee.',
    category: 'Food',
    outcomes: ['Yes', 'No'],
    b: 120,
    closesAt: fromStart(2),
    live: true,
  });
  ctx.createMarket({
    title: 'Who is first to leave the building for a nap?',
    description: 'First participant spotted leaving with the stated intent of sleeping. A walk to the car "to grab a charger" that lasts 40 minutes counts. Replace these names with real people.',
    category: 'People',
    outcomes: ['Sam', 'Priya', 'Jordan', 'Alex', 'Nobody naps'],
    b: 100,
    closesAt: fromStart(9),
  });
  ctx.createMarket({
    title: 'Will at least one demo crash live on stage?',
    description: "Yes if any team's demo throws an unhandled error, freezes, or needs a restart during final presentations.",
    category: 'Chaos',
    outcomes: ['Yes', 'No'],
    b: 150,
    closesAt: beforeEnd(1),
  });
  ctx.createMarket({
    title: 'Will the Wi-Fi go down during demos?',
    description: 'Yes if the venue Wi-Fi is unusable for more than 60 seconds while a team is presenting.',
    category: 'Chaos',
    outcomes: ['Yes', 'No'],
    b: 150,
    closesAt: beforeEnd(1),
  });
  ctx.createMarket({
    title: 'How many teams submit before the deadline?',
    description: 'Counts submissions received by the official deadline, not the grace period.',
    category: 'Chaos',
    outcomes: ['Everyone on time', 'One team late', 'Two or more late'],
    b: 120,
    closesAt: beforeEnd(2),
  });
}

const BOTS = ['ada', 'grace_h', 'linus', 'margaret', 'dennis_r', 'kenT', 'barbara', 'guido', 'brendan', 'matz', 'anders', 'bjarne', 'hopper', 'turing', 'lovelace'];

export function demoPack(ctx) {
  const now = Date.now();
  const rnd = mulberry32(42);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const bots = BOTS.map((n, i) => ctx.createUser(n, 'demo-bot-no-login', { bot: true, t: now - 4 * H + i * M }));
  const markets = Object.values(ctx.db.markets);
  // Backdate the starter markets so the demo shows a few hours of chart history.
  for (const m of markets) {
    m.createdAt = now - 3.5 * H;
    m.history[0].t = m.createdAt;
  }
  for (const e of ctx.db.events) if (e.type === 'new_market') e.t = now - 3.5 * H;
  const amounts = [5, 5, 10, 10, 10, 15, 20, 25, 25, 30, 40, 50, 50, 75, 100];

  // Make the demo feel like a few hours of trading history.
  for (const m of markets) {
    const nTrades = 18 + Math.floor(rnd() * 35);
    const fav = Math.floor(rnd() * m.outcomes.length);
    const second = (fav + 1 + Math.floor(rnd() * (m.outcomes.length - 1))) % m.outcomes.length;
    let t = now - 3 * H + rnd() * 10 * M;
    for (let k = 0; k < nTrades; k++) {
      t += rnd() * 7 * M;
      if (t >= now - M) break;
      const bot = pick(bots);
      const r = rnd();
      const idx = r < 0.45 ? fav : r < 0.7 ? second : Math.floor(rnd() * m.outcomes.length);
      const outcome = m.outcomes[idx];
      const pos = ctx.db.positions[`${bot.id}:${m.id}`];
      const owned = pos?.shares?.[outcome.id] || 0;
      try {
        if (owned > 5 && rnd() < 0.18) {
          ctx.executeTrade({ user: bot, market: m, outcomeId: outcome.id, side: 'sell', shares: owned * (0.3 + rnd() * 0.7), t, silent: true });
        } else {
          const amount = Math.min(pick(amounts), Math.floor(bot.balance));
          if (amount >= 1) ctx.executeTrade({ user: bot, market: m, outcomeId: outcome.id, side: 'buy', amount, t, silent: true });
        }
      } catch { /* bot ran out of money etc. */ }
    }
  }

  // One already-settled market so the leaderboard and portfolio history have something in them.
  const settled = ctx.createMarket({
    title: 'Will the opening keynote start on time?',
    description: 'Yes if the first slide is up within 5 minutes of the scheduled start.',
    category: 'Chaos',
    outcomes: ['Yes', 'No'],
    b: 120,
    closesAt: null,
  }, { t: now - 4 * H });
  let t = now - 4 * H + 2 * M;
  for (let k = 0; k < 24; k++) {
    t += rnd() * 4 * M;
    const bot = pick(bots);
    const idx = rnd() < 0.6 ? 1 : 0;
    const amount = Math.min(pick(amounts), Math.floor(bot.balance));
    try { if (amount >= 1) ctx.executeTrade({ user: bot, market: settled, outcomeId: settled.outcomes[idx].id, side: 'buy', amount, t, silent: true }); } catch { /* ignore */ }
  }
  settled.closesAt = now - 2 * H;
  settled.status = 'closed';
  ctx.resolveMarket(settled, settled.outcomes[1].id, { silent: true, t: now - 2 * H + 5 * M });
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
