import { EXCHANGE_URL, INFO_URL } from "./config.mjs";

/**
 * Hard guard: this process never talks to the exchange endpoint.
 * @param {string} url
 */
export function assertInfoOnlyUrl(url) {
  const parsed = new URL(url);
  if (parsed.pathname.replace(/\/$/, "") === "/exchange") {
    throw new Error("LIVE OFF — refused POST /exchange. Info API only.");
  }
  if (url === EXCHANGE_URL || parsed.href.startsWith(EXCHANGE_URL)) {
    throw new Error("LIVE OFF — refused exchange URL. Info API only.");
  }
}

/**
 * POST to Hyperliquid /info only. Never invent payloads or prices.
 * @param {Record<string, unknown>} body
 * @param {{ fetchImpl?: typeof fetch, infoUrl?: string }} [opts]
 */
export async function postInfo(body, opts = {}) {
  const infoUrl = opts.infoUrl ?? INFO_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  assertInfoOnlyUrl(infoUrl);
  const res = await fetchImpl(infoUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`info API ${body.type} failed: HTTP ${res.status} ${text}`);
  }
  return res.json();
}

export async function fetchAllMids(opts) {
  const mids = await postInfo({ type: "allMids" }, opts);
  if (!mids || typeof mids !== "object" || Array.isArray(mids)) {
    throw new Error("info allMids: unexpected payload — refusing to invent prices");
  }
  return mids;
}

export async function fetchL2Book(coin, opts) {
  const raw = await postInfo({ type: "l2Book", coin }, opts);
  return parseL2Book(coin, raw);
}

/**
 * Normalize an l2Book response. Bids = levels[0], asks = levels[1].
 * Empty or malformed books fail closed — we never invent a price.
 */
export function parseL2Book(coin, raw) {
  const levels = Array.isArray(raw) ? raw : raw?.levels;
  if (!Array.isArray(levels) || levels.length < 2) {
    throw new Error(`l2Book ${coin}: missing levels — refusing to invent prices`);
  }
  const bids = normalizeLevels(levels[0], "bid");
  const asks = normalizeLevels(levels[1], "ask");
  if (bids.length === 0 || asks.length === 0) {
    throw new Error(`l2Book ${coin}: empty ${bids.length === 0 ? "bids" : "asks"} — refusing to invent prices`);
  }
  const bestBid = bids[0].px;
  const bestAsk = asks[0].px;
  if (!(bestBid > 0) || !(bestAsk > 0) || bestAsk < bestBid) {
    throw new Error(`l2Book ${coin}: crossed or invalid book (${bestBid}/${bestAsk})`);
  }
  const mid = (bestBid + bestAsk) / 2;
  return {
    coin,
    time: raw?.time ?? null,
    bids,
    asks,
    bestBid,
    bestAsk,
    mid,
  };
}

function normalizeLevels(side, label) {
  if (!Array.isArray(side) || side.length === 0) return [];
  return side.map((lvl, i) => {
    const px = Number(lvl.px ?? lvl.price);
    const sz = Number(lvl.sz ?? lvl.size);
    if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(sz) || sz < 0) {
      throw new Error(`l2Book ${label}[${i}]: invalid px/sz — refusing to invent prices`);
    }
    return { px, sz, n: Number(lvl.n ?? 0) };
  });
}

/**
 * Prefer the allMids quote when present; otherwise mid from the live book.
 * Never falls back to a hardcoded or random price.
 */
export function midForCoin(coin, mids, book) {
  const quoted = mids?.[coin];
  if (quoted != null && quoted !== "") {
    const n = Number(quoted);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`allMids ${coin}=${quoted} is not a usable price`);
    }
    return n;
  }
  if (book?.mid > 0) return book.mid;
  throw new Error(`no live mid for ${coin} — refusing to invent prices`);
}
