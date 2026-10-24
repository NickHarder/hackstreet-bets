// Unit tests for the LMSR market maker maths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lmsrPrices, lmsrCost, lmsrTradeCost, lmsrSharesForCost } from '../server/market.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('a fresh market prices every outcome equally', () => {
  for (const n of [2, 3, 6, 12]) lmsrPrices(new Array(n).fill(0), 150).forEach((p) => close(p, 1 / n));
});

test('prices always sum to 1', () => {
  for (const qs of [[0, 0], [500, -20], [10, 300, 7, 0, 1], [1e6, 0, 0]]) {
    close(lmsrPrices(qs, 100).reduce((a, b) => a + b, 0), 1);
  }
});

test('huge share counts do not overflow', () => {
  const p = lmsrPrices([1e7, 0], 20);
  assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
  close(p[0], 1);
  assert.ok(Number.isFinite(lmsrCost([1e7, 0], 20)));
});

test('sharesForCost is the exact inverse of tradeCost', () => {
  const qs = [40, 10, 0, 120];
  for (const cash of [1, 10, 99.5, 1000]) {
    for (let i = 0; i < qs.length; i++) {
      const shares = lmsrSharesForCost(qs, 150, i, cash);
      close(lmsrTradeCost(qs, 150, i, shares), cash, 1e-7);
    }
  }
});

test('buying raises that outcome\'s price and lowers the others', () => {
  const qs = [0, 0, 0];
  const before = lmsrPrices(qs, 100);
  const sh = lmsrSharesForCost(qs, 100, 1, 50);
  const after = lmsrPrices([0, sh, 0], 100);
  assert.ok(after[1] > before[1]);
  assert.ok(after[0] < before[0] && after[2] < before[2]);
});

test('a bet always buys more shares than dollars spent (price is below $1)', () => {
  assert.ok(lmsrSharesForCost([0, 0], 150, 0, 100) > 100);
});

test('buying then immediately selling the same shares refunds exactly the stake', () => {
  const qs = [5, 30];
  const sh = lmsrSharesForCost(qs, 120, 0, 75);
  close(-lmsrTradeCost([qs[0] + sh, qs[1]], 120, 0, -sh), 75, 1e-7);
});

test('the market maker can lose at most b * ln(N)', () => {
  // Worst case: everyone piles into the eventual winner.
  const b = 150; const n = 4;
  const qs = [0, 0, 0, 0];
  const shares = lmsrSharesForCost(qs, b, 0, 1e5);
  const paid = 1e5; const payout = shares;
  assert.ok(payout - paid <= b * Math.log(n) + 1e-6);
});
