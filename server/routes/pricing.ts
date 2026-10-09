import { Router } from "express";
import { estimateValue } from "../services/valuation.js";
import { applyDistances } from "../services/distance.js";
import { scoreDeal } from "../services/deal-scorer.js";
import { getDb } from "../db/index.js";

const router = Router();

function insertMarketPrice(
  db: any,
  listing: any,
  result: { estimatedValue: number; comparables: unknown[]; source: string; salesPerWeek?: number | null }
) {
  db.prepare(`
    INSERT INTO market_prices (listing_id, query, estimated_market_value, reverb_listings, value_source, sales_per_week)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(listing.id, listing.title, result.estimatedValue, JSON.stringify(result.comparables), result.source, result.salesPerWeek ?? null);
}

// Backfill valuations for listings that have none, and re-check ones whose
// current estimate came from Reverb asking prices (the garbage-prone source).
// Runs in the background — a full pass takes minutes and would time out the
// browser's request otherwise.
let backfillRunning = false;

router.post("/backfill", (_req, res) => {
  if (backfillRunning) {
    return res.status(409).json({ error: "A value check is already running — watch the terminal." });
  }
  const db = getDb();
  const listings = db.prepare(`
    SELECT l.*, mp.value_source as prior_source FROM listings l
    LEFT JOIN (
      SELECT listing_id, value_source,
        ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY checked_at DESC) as rn
      FROM market_prices
    ) mp ON mp.listing_id = l.id AND mp.rn = 1
    WHERE mp.listing_id IS NULL OR mp.value_source = 'reverb_asking'
  `).all() as any[];

  if (listings.length === 0) {
    return res.json({ ok: true, message: "All listings already have trustworthy values — nothing to re-check." });
  }

  backfillRunning = true;
  res.json({
    ok: true,
    message: `Re-checking values for ${listings.length} listings in the background (roughly ${Math.ceil(listings.length / 10)} minutes) — refresh the Dashboard as results come in.`,
  });

  (async () => {
    await applyDistances().catch((err) => console.error("Distance pass failed:", err));
    let checked = 0;
    for (const [i, listing] of listings.entries()) {
      const result = await estimateValue(listing.title);
      if (result) {
        insertMarketPrice(db, listing, result);
        checked++;
      } else if (listing.prior_source === "reverb_asking") {
        // No trustworthy data found — better unvalued than wrongly valued
        db.prepare("DELETE FROM market_prices WHERE listing_id = ?").run(listing.id);
      }
      if ((i + 1) % 10 === 0) {
        console.log(`Value re-check progress: ${i + 1}/${listings.length} (${checked} valued)`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log(`Value re-check done: ${checked} of ${listings.length} listings got a market value.`);
  })()
    .catch((err) => console.error("Backfill failed:", err))
    .finally(() => {
      backfillRunning = false;
    });
});

// Trigger price check for a specific listing
router.post("/check/:listingId", async (req, res) => {
  try {
    const db = getDb();
    const listing = db.prepare("SELECT * FROM listings WHERE id = ?").get(req.params.listingId) as any;
    if (!listing) return res.status(404).json({ error: "Listing not found" });

    const marketPrice = await estimateValue(listing.title);
    if (marketPrice) {
      insertMarketPrice(db, listing, marketPrice);

      const deal = scoreDeal(listing.price, marketPrice.estimatedValue);
      res.json({ marketPrice, deal });
    } else {
      res.json({ marketPrice: null, deal: null });
    }
  } catch (err) {
    console.error("Price check failed:", err);
    res.status(500).json({ error: "Price check failed" });
  }
});

// Bulk price check for all unpriced listings in a search
router.post("/check-search/:searchId", async (req, res) => {
  try {
    const db = getDb();
    const listings = db.prepare(`
      SELECT l.* FROM listings l
      LEFT JOIN market_prices mp ON mp.listing_id = l.id
      WHERE l.search_id = ? AND mp.id IS NULL
    `).all(req.params.searchId) as any[];

    let checked = 0;
    for (const listing of listings) {
      const marketPrice = await estimateValue(listing.title);
      if (marketPrice) {
        insertMarketPrice(db, listing, marketPrice);
        checked++;
      }
      // Delay between requests to be polite
      await new Promise((r) => setTimeout(r, 1000));
    }

    res.json({ checked, total: listings.length });
  } catch (err) {
    console.error("Bulk price check failed:", err);
    res.status(500).json({ error: "Bulk price check failed" });
  }
});

export default router;
