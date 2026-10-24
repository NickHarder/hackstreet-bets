// Browser smoke test: drives the real UI in headless Chromium.
// Skips (instead of failing) when Playwright isn't installed. To enable it:
//   npm i -D playwright && npx playwright install chromium
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startServer, ADMIN_PASSWORD } from './helpers.js';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* not installed */ }
const skip = chromium ? false : 'Playwright not installed (npm i -D playwright && npx playwright install chromium)';

let server; let browser;
before(async () => { if (skip) return; server = await startServer(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

async function openAs(name, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(server.url);
  await page.waitForSelector('.market-card');
  await page.click('[data-action="login"]');
  await page.fill('#authForm [name=name]', name);
  await page.fill('#authForm [name=pin]', '1234');
  await page.click('#authForm button[type=submit]');
  await page.waitForSelector('.user-chip');
  return { page, errors };
}

test('players can sign up, bet, create a market, and report a problem', { skip, timeout: 60000 }, async () => {
  const { page, errors } = await openAs('ui_player');
  // Bet from the featured market.
  await page.locator('.featured .bar-row').first().click();
  await page.waitForSelector('#amt');
  await page.click('[data-amt="25"]');
  assert.match(await page.textContent('.est'), /Payout if/);
  await page.click('#tradeBtn');
  await page.waitForSelector('#positionBox .card');
  assert.match(await page.textContent('.toast'), /Bought/);
  // Create a market.
  await page.click('#nav-create');
  await page.waitForSelector('#createForm');
  assert.equal(await page.locator('#createForm [name=b]').count(), 0, 'players do not see liquidity');
  await page.fill('#createForm [name=title]', 'UI test: will the build pass?');
  await page.click('#createForm button.primary');
  await page.waitForSelector('.market-head');
  assert.match(await page.textContent('.market-head .meta'), /ui_player/);
  // Report it.
  await page.click('[data-action="flag"]');
  await page.fill('#flagForm [name=reason]', 'Testing the report button');
  await page.click('#flagForm button[type=submit]');
  await page.waitForSelector('.flags');
  assert.deepEqual(errors, []);
});

test('admins resolve from the market page and players see it live', { skip, timeout: 60000 }, async () => {
  const p = await openAs('ui_bettor');
  const a = await openAs('ui_admin');
  await a.page.goto(server.url + '/#/admin');
  await a.page.waitForSelector('#adminLogin');
  await a.page.fill('#adminLogin [name=password]', ADMIN_PASSWORD);
  await a.page.click('#adminLogin button');
  await a.page.waitForSelector('.tabs');
  // Player opens a binary market and bets Yes.
  await p.page.goto(server.url);
  await p.page.waitForSelector('.yn .yes');
  await p.page.locator('.market-card .yn .yes').first().click();
  await p.page.waitForSelector('#amt');
  await p.page.fill('#amt', '40');
  await p.page.click('#tradeBtn');
  await p.page.waitForSelector('#positionBox .card');
  // Admin resolves the same market to Yes from the market page.
  await a.page.goto(p.page.url());
  await a.page.waitForSelector('.admin-card [data-aresolve]');
  await a.page.click('.admin-card [data-aresolve]');
  await p.page.waitForSelector('.banner.resolved', { timeout: 5000 });
  // Then voids it; the player is refunded to exactly $1,000.
  await a.page.waitForSelector('.admin-card [data-avoid]');
  await a.page.click('.admin-card [data-avoid]');
  await p.page.waitForSelector('.banner.voided', { timeout: 5000 });
  await p.page.waitForFunction(() => document.querySelector('.user-chip') && /1,000\.00/.test(document.getElementById('topbar-right').textContent), null, { timeout: 5000 });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(a.errors, []);
});

test('typing into the sign-in box is never redirected to another field', { skip, timeout: 30000 }, async () => {
  // Regression: the dialog used to focus its first field on a timer. On a slow
  // device that timer could fire while someone was typing their PIN, moving the
  // cursor so the rest of the PIN landed in the name box. A controlled clock
  // lets us fire any pending timers at exactly that moment.
  const page = await (await browser.newContext()).newPage();
  await page.clock.install();
  await page.goto(server.url);
  await page.waitForSelector('.market-card');
  await page.clock.pauseAt(Date.now() + 60000); // freeze timers from here on
  await page.click('[data-action="login"]');
  await page.click('#authForm [name=pin]');
  await page.keyboard.type('43');
  await page.clock.runFor(1000);
  await page.keyboard.type('21');
  assert.equal(await page.inputValue('#authForm [name=pin]'), '4321');
  assert.equal(await page.inputValue('#authForm [name=name]'), '');
});

test('pages fit a phone screen without sideways scrolling', { skip, timeout: 60000 }, async () => {
  const { page, errors } = await openAs('ui_phone', { width: 390, height: 844 });
  for (const hash of ['#/', '#/leaderboard', '#/portfolio', '#/activity', '#/create']) {
    await page.goto(server.url + '/' + hash);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow on ${hash}`);
  }
  assert.deepEqual(errors, []);
});
