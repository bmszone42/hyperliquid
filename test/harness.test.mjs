import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LIVE, MODE, STARTING_EQUITY_USDC, armLive, rejectLiveFlags } from "../src/config.mjs";
import { assertInfoOnlyUrl, midForCoin, parseL2Book } from "../src/info.mjs";
import { applyFill, freshLedger, markToMarket, saveLedger } from "../src/ledger.mjs";
import { runPaper } from "../src/paper.mjs";
import { simFill, sizeFromNotional } from "../src/sim.mjs";

const fixtureBook = {
  coin: "BTC",
  time: 1,
  levels: [
    [
      { px: "100000", sz: "2", n: 1 },
      { px: "99990", sz: "3", n: 1 },
    ],
    [
      { px: "100010", sz: "1.5", n: 1 },
      { px: "100020", sz: "4", n: 1 },
    ],
  ],
};

test("LIVE is hard-off and ARM LIVE throws", () => {
  assert.equal(LIVE, false);
  assert.equal(MODE, "PAPER");
  assert.equal(STARTING_EQUITY_USDC, 1000);
  assert.throws(() => armLive(), /LIVE OFF/);
  assert.throws(() => rejectLiveFlags(["--live"]), /LIVE OFF/);
  assert.throws(() => rejectLiveFlags(["--arm-live"]), /LIVE OFF/);
});

test("info client refuses /exchange", () => {
  assert.throws(() => assertInfoOnlyUrl("https://api.hyperliquid.xyz/exchange"), /exchange/);
});

test("parseL2Book uses real levels and refuses empty books", () => {
  const book = parseL2Book("BTC", fixtureBook);
  assert.equal(book.bestBid, 100000);
  assert.equal(book.bestAsk, 100010);
  assert.equal(book.mid, 100005);
  assert.throws(() => parseL2Book("BTC", { levels: [[], []] }), /invent/);
});

test("simFill walks live asks and never invents a price", () => {
  const book = parseL2Book("BTC", fixtureBook);
  const fill = simFill("buy", 2, book, { coin: "BTC" });
  assert.equal(fill.legs.length, 2);
  assert.equal(fill.legs[0].px, 100010);
  assert.equal(fill.legs[1].px, 100020);
  assert.equal(fill.px, (1.5 * 100010 + 0.5 * 100020) / 2);
  assert.throws(() => simFill("buy", 100, book, { coin: "BTC" }), /thin/);
});

test("sizeFromNotional uses live ask only", () => {
  const book = parseL2Book("BTC", fixtureBook);
  assert.equal(sizeFromNotional("buy", 10, book), 10 / 100010);
});

test("midForCoin refuses missing quotes", () => {
  assert.equal(midForCoin("BTC", { BTC: "111" }, null), 111);
  assert.throws(() => midForCoin("XYZ", {}, null), /invent/);
});

test("fresh ledger is $1000 PAPER and MTM stays ~1000 when flat", () => {
  const ledger = freshLedger();
  assert.equal(ledger.cash, 1000);
  assert.equal(ledger.live, false);
  const { equity } = markToMarket(ledger, { BTC: 100005 });
  assert.equal(equity, 1000);
});

test("applyFill is perp-style: open does not spend full notional", () => {
  const book = parseL2Book("BTC", fixtureBook);
  const fill = simFill("buy", 0.001, book, { coin: "BTC" });
  const next = applyFill(freshLedger(), fill);
  assert.ok(next.cash > 999);
  const { equity } = markToMarket(next, { BTC: book.mid });
  assert.ok(equity > 999 && equity < 1001);
});

test("runPaper --once uses injected live books and keeps equity ~1000", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hl-paper-"));
  const path = join(dir, "ledger.json");
  const book = parseL2Book("BTC", fixtureBook);
  const eth = parseL2Book("ETH", {
    coin: "ETH",
    time: 1,
    levels: [
      [{ px: "4000", sz: "10", n: 1 }],
      [{ px: "4002", sz: "10", n: 1 }],
    ],
  });

  const { report } = await runPaper(["--once"], {
    fetchAllMids: async () => ({ BTC: "100005", ETH: "4001" }),
    fetchL2Book: async (coin) => (coin === "ETH" ? eth : book),
    loadLedger: async () => freshLedger(),
    saveLedger: async (ledger) => saveLedger(ledger, path),
  });

  assert.equal(report.mode, "PAPER");
  assert.equal(report.live, false);
  assert.equal(report.liveOff, true);
  assert.ok(Math.abs(report.equity - 1000) < 0.01);
  assert.equal(report.probe.committed, false);
  assert.equal(report.probe.px, 100010);
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(saved.live, false);
  assert.equal(saved.mode, "PAPER");
});
