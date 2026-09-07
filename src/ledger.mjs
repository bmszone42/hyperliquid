import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEDGER_PATH, QUOTE, STARTING_EQUITY_USDC } from "./config.mjs";

export function freshLedger(now = new Date().toISOString()) {
  return {
    mode: "PAPER",
    live: false,
    quote: QUOTE,
    startingEquity: STARTING_EQUITY_USDC,
    cash: STARTING_EQUITY_USDC,
    positions: {},
    fills: [],
    createdAt: now,
    updatedAt: now,
  };
}

function ledgerFilePath(path = LEDGER_PATH) {
  return typeof path === "string" ? path : fileURLToPath(path);
}

export async function loadLedger(path = LEDGER_PATH) {
  const file = ledgerFilePath(path);
  try {
    const raw = await readFile(file, "utf8");
    const ledger = JSON.parse(raw);
    if (ledger.live === true || ledger.mode === "LIVE") {
      throw new Error("LIVE OFF — refusing a ledger marked LIVE");
    }
    return ledger;
  } catch (err) {
    if (err.code === "ENOENT") return freshLedger();
    throw err;
  }
}

export async function saveLedger(ledger, path = LEDGER_PATH) {
  const file = ledgerFilePath(path);
  await mkdir(dirname(file), { recursive: true });
  const next = {
    ...ledger,
    mode: "PAPER",
    live: false,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(file, JSON.stringify(next, null, 2) + "\n");
  return next;
}

/**
 * Mark-to-market equity from live mids. Positions are signed size (long + / short −).
 * @param {object} ledger
 * @param {Record<string, number>} midsByCoin
 */
export function markToMarket(ledger, midsByCoin) {
  let unrealized = 0;
  const marked = [];
  for (const [coin, pos] of Object.entries(ledger.positions || {})) {
    if (!pos || !pos.sz) continue;
    const mid = midsByCoin[coin];
    if (!(mid > 0)) {
      throw new Error(`cannot mark ${coin}: missing live mid — refusing to invent prices`);
    }
    const pnl = (mid - pos.avgPx) * pos.sz;
    unrealized += pnl;
    marked.push({
      coin,
      sz: pos.sz,
      avgPx: pos.avgPx,
      mid,
      upl: roundUsd(pnl),
      notional: roundUsd(Math.abs(pos.sz) * mid),
    });
  }
  const equity = roundUsd(ledger.cash + unrealized);
  return { equity, unrealized: roundUsd(unrealized), positions: marked };
}

export function applyFill(ledger, fill) {
  const { coin, side, px, sz, fee = 0 } = fill;
  if (!(px > 0) || !(sz > 0)) {
    throw new Error("fill missing live px/sz — refusing to invent prices");
  }
  const signed = side === "buy" ? sz : -sz;
  const positions = { ...(ledger.positions || {}) };
  const prev = positions[coin] || { sz: 0, avgPx: 0 };
  const nextSz = prev.sz + signed;

  let realized = 0;
  let avgPx = prev.avgPx;
  if (prev.sz === 0) {
    avgPx = px;
  } else if (Math.sign(prev.sz) === Math.sign(signed)) {
    avgPx = (Math.abs(prev.sz) * prev.avgPx + sz * px) / (Math.abs(prev.sz) + sz);
  } else {
    const closed = Math.min(Math.abs(prev.sz), sz);
    realized = (px - prev.avgPx) * closed * Math.sign(prev.sz);
    avgPx = nextSz === 0 ? 0 : px;
  }

  if (Math.abs(nextSz) < 1e-12) delete positions[coin];
  else positions[coin] = { sz: nextSz, avgPx };

  const nextFill = {
    ...fill,
    fee,
    realized: roundUsd(realized),
    time: fill.time ?? new Date().toISOString(),
    source: "sim",
  };

  // Perp-style paper cash: fees and realized PnL only. Notional stays on the book.
  return {
    ...ledger,
    cash: ledger.cash - fee + realized,
    positions,
    fills: [...(ledger.fills || []), nextFill],
  };
}

export function roundUsd(n) {
  return Math.round(n * 1e6) / 1e6;
}
