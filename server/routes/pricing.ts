import { Router } from "express";
import { estimateValue } from "../services/valuation.js";
import { scoreDeal } from "../services/deal-scorer.js";
import { getDb } from "../db/index.js";

const router = Router();

function insertMarketPrice(
  db: any,
  listing: any,
  result: { estimatedValue: number; comparables: unknown[]; source: string }
) {
  db.prepare(`
    INSERT INTO market_prices (listing_id, query, estimated_market_value, reverb_listings, value_source)
    VALUES (?, ?, ?, ?, ?)
  `).run(listing.id, listing.title, result.estimatedValue, JSON.stringify(result.comparables), result.source);
}

// Backfill valuations for every listing that has none (Reverb -> eBay sold)
router.post("/backfill", async (_req, res) => {
  try {
    const db = getDb();
    const listings = db.prepare(`
      SELECT l.* FROM listings l
      LEFT JOIN market_prices mp ON mp.listing_id = l.id
      WHERE mp.id IS NULL
    `).all() as any[];

    let checked = 0;
    for (const listing of listings) {
      const result = await estimateValue(listing.title);
      if (result) {
        insertMarketPrice(db, listing, result);
        checked++;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    res.json({ checked, total: listings.length });
  } catch (err) {
    console.error("Backfill failed:", err);
    res.status(500).json({ error: "Backfill failed" });
  }
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
