/**
 * Simulate fills by walking the live Hyperliquid L2 book.
 * Never invents a price. If the book cannot fill the size, fail closed.
 */

/**
 * @param {"buy"|"sell"} side
 * @param {number} sz
 * @param {{ bids: {px:number,sz:number}[], asks: {px:number,sz:number}[] }} book
 * @param {{ coin?: string, feeRate?: number }} [opts]
 */
export function simFill(side, sz, book, opts = {}) {
  if (side !== "buy" && side !== "sell") {
    throw new Error(`simFill: invalid side ${side}`);
  }
  if (!(sz > 0)) {
    throw new Error("simFill: size must be > 0");
  }
  const levels = side === "buy" ? book?.asks : book?.bids;
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error(`simFill: no live ${side === "buy" ? "asks" : "bids"} — refusing to invent prices`);
  }

  let remaining = sz;
  let notional = 0;
  const legs = [];

  for (const level of levels) {
    if (remaining <= 0) break;
    if (!(level.px > 0) || !(level.sz > 0)) {
      throw new Error("simFill: book level missing px/sz — refusing to invent prices");
    }
    const take = Math.min(remaining, level.sz);
    legs.push({ px: level.px, sz: take, n: level.n ?? 0 });
    notional += take * level.px;
    remaining -= take;
  }

  if (remaining > 1e-12) {
    throw new Error(
      `simFill: book too thin to fill ${sz} ${opts.coin ?? ""} on ${side} (${remaining} unfilled) — refusing to invent prices`,
    );
  }

  const avgPx = notional / sz;
  const feeRate = opts.feeRate ?? 0;
  const fee = notional * feeRate;
  return {
    coin: opts.coin,
    side,
    sz,
    px: avgPx,
    notional,
    fee,
    legs,
    source: "sim",
    bookTime: book.time ?? null,
  };
}

/**
 * Size a probe from a USDC notional using the live best ask (buy) or bid (sell).
 * Size is derived from the book — never from a guessed price.
 */
export function sizeFromNotional(side, notionalUsdc, book) {
  if (!(notionalUsdc > 0)) throw new Error("notional must be > 0");
  const px = side === "buy" ? book?.bestAsk ?? book?.asks?.[0]?.px : book?.bestBid ?? book?.bids?.[0]?.px;
  if (!(px > 0)) {
    throw new Error("cannot size order: missing live top-of-book — refusing to invent prices");
  }
  return notionalUsdc / px;
}
