import { getDb } from "../db/index.js";
import { facebookScraper } from "../scrapers/facebook.js";

// Marketplace listings go stale: a flip found Monday sells Wednesday, and
// nothing ever told us. Each sweep re-checks a few of the most valuable,
// still-shown listings and retires the ones that are gone, so the Dashboard
// never offers something that already sold.

// ===== Liveness tunables =====
export const FRESH_FLIP_DAYS = 4; // flips older than this stop showing as buyable
const CHECKS_PER_SWEEP = 8; // polite: a handful of re-checks per hourly sweep
const RECHECK_HOURS = 12; // don't re-visit the same listing more often than this

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

export async function checkListingLiveness(): Promise<void> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT l.id, l.source, l.listing_url,
        COALESCE((SELECT MAX(estimated_market_value) FROM market_prices WHERE listing_id = l.id), 0) AS value
      FROM listings l
      WHERE l.delisted_at IS NULL
        AND l.source IN ('facebook', 'craigslist')
        AND datetime(l.scraped_at) >= datetime('now', '-${FRESH_FLIP_DAYS} days')
        AND (l.live_checked_at IS NULL OR datetime(l.live_checked_at) <= datetime('now', '-${RECHECK_HOURS} hours'))
      ORDER BY value DESC
      LIMIT ${CHECKS_PER_SWEEP}`
    )
    .all() as Array<{ id: number; source: string; listing_url: string }>;
  if (rows.length === 0) return;

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

  if (retired > 0) {
    console.log(`Liveness check: retired ${retired} listing(s) that already sold or were removed.`);
  }
}
