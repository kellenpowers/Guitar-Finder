import { getDb } from "../db/index.js";
import { facebookScraper } from "../scrapers/facebook.js";
import { getEbayAppToken } from "../scrapers/ebay.js";

// Marketplace listings go stale: a flip found Monday sells Wednesday, and
// nothing ever told us. Each sweep re-checks a few of the most valuable,
// still-shown listings and retires the ones that are gone, so the Dashboard
// never offers something that already sold.

// ===== Liveness tunables =====
export const FRESH_FLIP_DAYS = 4; // flips older than this stop showing as buyable
// Facebook/OfferUp deals die in hours, not days — show them for less time
export const FAST_SOURCE_FRESH_DAYS = 2;
// Re-check caps per hourly sweep (raised at the owner's request, Oct 2026 —
// too many dead listings were slipping through at 8/sweep). Craigslist checks
// are cheap plain fetches; Facebook ones open real pages, so stay moderate.
const CL_CHECKS_PER_SWEEP = 20;
const FB_CHECKS_PER_SWEEP = 12;
// eBay and Reverb are checked through their OFFICIAL APIs — no scraping, so
// the caps can be generous
const EBAY_CHECKS_PER_SWEEP = 40;
const REVERB_CHECKS_PER_SWEEP = 20;
const RECHECK_HOURS = 12; // don't re-visit the same listing more often than this
// Prioritize re-checking what the Dashboard actually shows: items whose value
// clears roughly the margin doctrine (profit ≈ price). Others go later.
const LIKELY_FLIP_VALUE_RATIO = 1.8;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const delay = (min: number, max: number) =>
  new Promise((r) => setTimeout(r, Math.floor(Math.random() * (max - min) + min)));

// Pure detectors — exported for tests.
export function craigslistGone(status: number, html: string): boolean {
  if (status === 404 || status === 410) return true;
  return /posting has (been deleted|been flagged|expired)|page not found/i.test(html);
}

export function facebookGone(pageText: string): boolean {
  if (/this (listing|content) isn'?t available|no longer available|listing unavailable/i.test(pageText)) {
    return true;
  }
  // The Sold/Pending badge renders as its own short line near the top
  return pageText
    .split("\n")
    .slice(0, 40)
    .some((l) => /^(sold|pending|sale pending)$/i.test(l.trim()));
}

// Ask eBay's Browse API whether a listing is still live. true = gone,
// false = live, null = couldn't tell (leave the listing alone).
async function ebayGoneByApi(legacyId: string, token: string): Promise<boolean | null> {
  const res = await fetch(
    `https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(legacyId)}`,
    { headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } }
  );
  if (res.status === 404) return true;
  if (!res.ok) return null;
  const item = await res.json().catch(() => null);
  if (!item) return null;
  const availability = item?.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus;
  if (availability === "OUT_OF_STOCK") return true;
  if (item?.itemEndDate && Date.parse(item.itemEndDate) < Date.now()) return true;
  return false;
}

async function reverbGoneByApi(listingId: string, token: string): Promise<boolean | null> {
  const res = await fetch(`https://api.reverb.com/api/listings/${encodeURIComponent(listingId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/hal+json",
      "Accept-Version": "3.0",
    },
  });
  if (res.status === 404) return true;
  if (!res.ok) return null;
  const listing = await res.json().catch(() => null);
  const slug = listing?.state?.slug ?? listing?.state;
  if (!slug) return null;
  return String(slug) !== "live";
}

export async function checkListingLiveness(): Promise<void> {
  const db = getDb();
  const candidates = (source: string, limit: number) =>
    db
      .prepare(
        `SELECT l.id, l.source, l.listing_url, l.external_id, l.price,
          COALESCE((SELECT MAX(estimated_market_value) FROM market_prices WHERE listing_id = l.id), 0) AS value
        FROM listings l
        WHERE l.delisted_at IS NULL
          AND l.source = ?
          AND datetime(l.scraped_at) >= datetime('now', '-${FRESH_FLIP_DAYS} days')
          AND (l.live_checked_at IS NULL OR datetime(l.live_checked_at) <= datetime('now', '-${RECHECK_HOURS} hours'))
        ORDER BY (CASE WHEN value >= ${LIKELY_FLIP_VALUE_RATIO} * MAX(l.price, 1) THEN 1 ELSE 0 END) DESC,
          value DESC
        LIMIT ${limit}`
      )
      .all(source) as Array<{ id: number; source: string; listing_url: string; external_id: string }>;

  const rows = [...candidates("craigslist", CL_CHECKS_PER_SWEEP), ...candidates("facebook", FB_CHECKS_PER_SWEEP)];

  const touch = db.prepare("UPDATE listings SET live_checked_at = datetime('now') WHERE id = ?");
  const retire = db.prepare(
    "UPDATE listings SET delisted_at = datetime('now'), live_checked_at = datetime('now') WHERE id = ?"
  );
  let retired = 0;

  for (const row of rows.filter((r) => r.source === "craigslist")) {
    try {
      const res = await fetch(row.listing_url, { headers: { "User-Agent": BROWSER_UA } });
      const html = res.ok ? await res.text() : "";
      if (craigslistGone(res.status, html)) {
        retire.run(row.id);
        retired++;
      } else {
        touch.run(row.id);
      }
    } catch {
      // network blip — leave untouched so the next sweep retries
    }
    await delay(1500, 3000);
  }

  const fbRows = rows.filter((r) => r.source === "facebook");
  if (fbRows.length > 0) {
    const texts = await facebookScraper
      .pageTexts(fbRows.map((r) => r.listing_url))
      .catch(() => new Map<string, string>());
    for (const row of fbRows) {
      const text = texts.get(row.listing_url);
      if (text === undefined) continue; // page didn't load — retry next time
      if (facebookGone(text)) {
        retire.run(row.id);
        retired++;
      } else {
        touch.run(row.id);
      }
    }
  }

  // eBay via the official Browse API — ended/sold items vanish within a sweep
  const ebayRows = candidates("ebay", EBAY_CHECKS_PER_SWEEP);
  if (ebayRows.length > 0 && process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET) {
    try {
      const token = await getEbayAppToken();
      for (const row of ebayRows) {
        const gone = await ebayGoneByApi(row.external_id, token).catch(() => null);
        if (gone === true) {
          retire.run(row.id);
          retired++;
        } else if (gone === false) {
          touch.run(row.id);
        }
        await delay(150, 400);
      }
    } catch (err) {
      console.warn("Liveness: eBay API check failed:", err instanceof Error ? err.message : err);
    }
  }

  // Reverb via its official API
  const reverbRows = candidates("reverb", REVERB_CHECKS_PER_SWEEP);
  const reverbToken = process.env.REVERB_API_TOKEN;
  if (reverbRows.length > 0 && reverbToken) {
    for (const row of reverbRows) {
      const gone = await reverbGoneByApi(row.external_id, reverbToken).catch(() => null);
      if (gone === true) {
        retire.run(row.id);
        retired++;
      } else if (gone === false) {
        touch.run(row.id);
      }
      await delay(300, 700);
    }
  }

  if (retired > 0) {
    console.log(`Liveness check: retired ${retired} listing(s) that already sold or were removed.`);
  }
}
