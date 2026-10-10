import { getDb } from "../db/index.js";
import { facebookScraper } from "../scrapers/facebook.js";
import { RESALE_FEE_PCT, SHIPPING_EST } from "./profit.js";

// ===== Seller-name tunables =====
// Names only exist on listing detail pages, so this pass visits a FEW
// promising Facebook finds per sweep (politeness: each is one extra page
// load on the owner's session). Craigslist is anonymous; drafts fall back
// to "Hey," when no name is known.
const SELLER_LOOKUPS_PER_SWEEP = 8;
const MIN_PROFIT_FOR_LOOKUP = 40; // only listings worth messaging

export async function applySellerNames(): Promise<void> {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT l.id, l.listing_url FROM listings l
      JOIN (
        SELECT listing_id, estimated_market_value,
          ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY checked_at DESC) rn
        FROM market_prices
      ) mp ON mp.listing_id = l.id AND mp.rn = 1
      WHERE l.source = 'facebook' AND l.seller_name IS NULL
        AND mp.estimated_market_value * ${1 - RESALE_FEE_PCT} - ${SHIPPING_EST} - l.price >= ${MIN_PROFIT_FOR_LOOKUP}
      ORDER BY l.scraped_at DESC
      LIMIT ${SELLER_LOOKUPS_PER_SWEEP}
    `)
    .all() as Array<{ id: number; listing_url: string }>;
  if (rows.length === 0) return;

  try {
    const names = await facebookScraper.sellerNames(rows.map((r) => r.listing_url));
    const update = db.prepare("UPDATE listings SET seller_name = ? WHERE id = ?");
    let found = 0;
    for (const row of rows) {
      const name = names.get(row.listing_url) || "";
      if (name) found++;
      // '' marks "looked, not found" so we never retry the same page forever
      update.run(name, row.id);
    }
    console.log(`Seller names: found ${found} of ${rows.length} looked up.`);
  } catch (err) {
    console.error("Seller-name pass failed:", err instanceof Error ? err.message : err);
  }
}
