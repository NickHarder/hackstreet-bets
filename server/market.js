// LMSR (Logarithmic Market Scoring Rule) automated market maker.
// Every market has N outcomes with q[i] shares outstanding and a liquidity
// parameter b. Each share pays out 1 unit of currency if its outcome wins.
//
//   price_i = exp(q_i / b) / sum_j exp(q_j / b)        (prices always sum to 1)
//   C(q)    = b * ln( sum_j exp(q_j / b) )              (cost function)
//   cost of a trade = C(q_after) - C(q_before)
//
// Smaller b -> prices move more per trade. The functions below are written
// with max-subtraction so large q values never overflow Math.exp.

export function lmsrPrices(qs, b) {
  const m = Math.max(...qs);
  const ex = qs.map((q) => Math.exp((q - m) / b));
  const s = ex.reduce((a, c) => a + c, 0);
  return ex.map((e) => e / s);
}

export function lmsrCost(qs, b) {
  const m = Math.max(...qs);
  return m + b * Math.log(qs.reduce((a, q) => a + Math.exp((q - m) / b), 0));
}

/** Cash cost of changing q[i] by delta (positive = buy, negative = sell -> negative cost). */
export function lmsrTradeCost(qs, b, i, delta) {
  const q2 = qs.slice();
  q2[i] += delta;
  return lmsrCost(q2, b) - lmsrCost(qs, b);
}

/** How many shares of outcome i does `cash` buy? Closed form inverse of lmsrTradeCost. */
export function lmsrSharesForCost(qs, b, i, cash) {
  const m = Math.max(...qs);
  const ex = qs.map((q) => Math.exp((q - m) / b));
  const S = ex.reduce((a, c) => a + c, 0);
  const inner = S * Math.exp(cash / b) - S + ex[i];
  return b * Math.log(inner) + m - qs[i];
}
