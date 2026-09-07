#!/usr/bin/env node
/**
 * PAPER cycle: fetch live Hyperliquid books/mids, sim-fill against those
 * prices only, mark the $1000 USDC ledger. Never POSTs /exchange.
 */
import {
  DEFAULT_COINS,
  LIVE,
  MODE,
  PROBE_NOTIONAL_USDC,
  STARTING_EQUITY_USDC,
  assertPaperOnly,
  rejectLiveFlags,
} from "./config.mjs";
import { fetchAllMids, fetchL2Book, midForCoin } from "./info.mjs";
import { applyFill, loadLedger, markToMarket, saveLedger } from "./ledger.mjs";
import { simFill, sizeFromNotional } from "./sim.mjs";

export async function runPaper(argv = process.argv.slice(2), deps = {}) {
  rejectLiveFlags(argv);
  assertPaperOnly();

  const once = argv.includes("--once");
  const commitProbe = argv.includes("--commit-probe");
  const coins = parseCoins(argv);
  const fetchAllMidsFn = deps.fetchAllMids ?? fetchAllMids;
  const fetchL2BookFn = deps.fetchL2Book ?? fetchL2Book;
  const load = deps.loadLedger ?? loadLedger;
  const save = deps.saveLedger ?? saveLedger;

  let ledger = await load();
  const mids = await fetchAllMidsFn();
  const books = {};
  for (const coin of coins) {
    books[coin] = await fetchL2BookFn(coin);
  }

  const liveMids = {};
  for (const coin of coins) {
    liveMids[coin] = midForCoin(coin, mids, books[coin]);
  }

  const pending = ledger.orders || [];
  const newFills = [];
  for (const order of pending) {
    const book = books[order.coin];
    if (!book) {
      throw new Error(`no live book for resting order ${order.coin} — refusing to invent prices`);
    }
    const fill = simFill(order.side, order.sz, book, { coin: order.coin, feeRate: 0 });
    ledger = applyFill(ledger, fill);
    newFills.push(fill);
  }
  if (pending.length) ledger = { ...ledger, orders: [] };

  const probeCoin = coins[0];
  const probeBook = books[probeCoin];
  const probeSz = sizeFromNotional("buy", PROBE_NOTIONAL_USDC, probeBook);
  const probe = simFill("buy", probeSz, probeBook, { coin: probeCoin, feeRate: 0 });
  if (commitProbe) {
    ledger = applyFill(ledger, probe);
    newFills.push(probe);
  }

  const marked = markToMarket(ledger, {
    ...Object.fromEntries(
      Object.entries(mids).map(([k, v]) => [k, Number(v)]).filter(([, v]) => v > 0),
    ),
    ...liveMids,
  });

  ledger = await save({
    ...ledger,
    lastCycle: {
      at: new Date().toISOString(),
      coins,
      liveMids,
      books: Object.fromEntries(
        Object.entries(books).map(([coin, b]) => [
          coin,
          { bestBid: b.bestBid, bestAsk: b.bestAsk, mid: b.mid, time: b.time },
        ]),
      ),
      probe: {
        committed: commitProbe,
        coin: probe.coin,
        side: probe.side,
        sz: probe.sz,
        px: probe.px,
        notional: probe.notional,
        legs: probe.legs.length,
      },
      equity: marked.equity,
    },
  });

  const report = {
    mode: MODE,
    live: LIVE,
    liveOff: true,
    startingEquity: STARTING_EQUITY_USDC,
    equity: marked.equity,
    cash: ledger.cash,
    unrealized: marked.unrealized,
    positions: marked.positions,
    newFills: newFills.length,
    probe: {
      committed: commitProbe,
      coin: probe.coin,
      px: probe.px,
      sz: probe.sz,
      notional: probe.notional,
    },
    books: Object.fromEntries(
      Object.entries(books).map(([coin, b]) => [
        coin,
        { bid: b.bestBid, ask: b.bestAsk, mid: liveMids[coin] },
      ]),
    ),
    once,
  };

  return { ledger, report };
}

function parseCoins(argv) {
  const idx = argv.indexOf("--coins");
  if (idx >= 0 && argv[idx + 1]) {
    return argv[idx + 1].split(",").map((c) => c.trim()).filter(Boolean);
  }
  return [...DEFAULT_COINS];
}

function printReport(report) {
  const lines = [
    "=== Hyperliquid PAPER ===",
    `mode:          ${report.mode}`,
    `LIVE:          OFF`,
    `starting:      ${report.startingEquity.toFixed(2)} ${"USDC"}`,
    `equity:        ${report.equity.toFixed(4)} USDC`,
    `cash:          ${Number(report.cash).toFixed(4)} USDC`,
    `unrealized:    ${report.unrealized.toFixed(4)} USDC`,
    `positions:     ${report.positions.length === 0 ? "(flat)" : JSON.stringify(report.positions)}`,
    `sim-fill probe ${report.probe.coin} buy @ ${report.probe.px} (notional ~${report.probe.notional.toFixed(4)} USDC, committed=${report.probe.committed})`,
    "books (live info API):",
    ...Object.entries(report.books).map(
      ([coin, b]) => `  ${coin}  bid=${b.bid}  ask=${b.ask}  mid=${b.mid}`,
    ),
    "exchange POST: never",
    "ARM LIVE:      disabled",
  ];
  console.log(lines.join("\n"));
}

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runPaper()
    .then(({ report }) => {
      printReport(report);
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exitCode = 1;
    });
}
