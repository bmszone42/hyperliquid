/**
 * PAPER-only Hyperliquid harness.
 * LIVE is hard-off. There is no ARM LIVE path.
 */

export const MODE = "PAPER";
export const LIVE = false;
export const STARTING_EQUITY_USDC = 1000;
export const QUOTE = "USDC";

export const INFO_URL = "https://api.hyperliquid.xyz/info";
export const EXCHANGE_URL = "https://api.hyperliquid.xyz/exchange";

/** Coins fetched on each paper cycle. Prices always come from the info API. */
export const DEFAULT_COINS = ["BTC", "ETH"];

/** Tiny notional used only to exercise sim-fill against the live ask book. */
export const PROBE_NOTIONAL_USDC = 10;

export const LEDGER_PATH = new URL("../data/ledger.json", import.meta.url);

export function assertPaperOnly() {
  if (LIVE !== false || MODE !== "PAPER") {
    throw new Error("LIVE OFF — this harness cannot leave PAPER mode");
  }
  const blocked = [
    process.env.HL_LIVE,
    process.env.ARM_LIVE,
    process.env.HYPERLIQUID_LIVE,
  ];
  if (blocked.some((v) => v && !["0", "false", "off", "paper"].includes(String(v).toLowerCase()))) {
    throw new Error("LIVE OFF — refusing live/ARM env flags. PAPER only.");
  }
}

/**
 * ARM LIVE is permanently disabled. Any call is a hard error.
 * @param {...unknown} _args
 */
export function armLive(..._args) {
  throw new Error("LIVE OFF — ARM LIVE is disabled. This harness is PAPER only.");
}

export function rejectLiveFlags(argv = process.argv.slice(2)) {
  const blocked = new Set([
    "--live",
    "--arm-live",
    "--arm",
    "--exchange",
    "--mainnet-live",
  ]);
  for (const arg of argv) {
    const key = arg.split("=")[0];
    if (blocked.has(key) || key === "--mode" && arg.toLowerCase().includes("live")) {
      throw new Error(`LIVE OFF — rejected flag ${arg}. PAPER only; never POST /exchange.`);
    }
  }
}
