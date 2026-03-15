import { Router } from "express";
import { checkPrice } from "../services/reverb-checker.js";
import { scoreDeal } from "../services/deal-scorer.js";
import { getDb } from "../db/index.js";

const router = Router();

// Trigger price check for a specific listing
router.post("/check/:listingId", async (req, res) => {
  try {
    const db = getDb();
    const listing = db.prepare("SELECT * FROM listings WHERE id = ?").get(req.params.listingId) as any;
    if (!listing) return res.status(404).json({ error: "Listing not found" });

    const marketPrice = await checkPrice(listing.title);
    if (marketPrice) {
      db.prepare(`
        INSERT INTO market_prices (listing_id, query, estimated_market_value, reverb_listings)
        VALUES (?, ?, ?, ?)
      `).run(listing.id, listing.title, marketPrice.estimatedValue, JSON.stringify(marketPrice.comparables));

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
      const marketPrice = await checkPrice(listing.title);
      if (marketPrice) {
        db.prepare(`
          INSERT INTO market_prices (listing_id, query, estimated_market_value, reverb_listings)
          VALUES (?, ?, ?, ?)
        `).run(listing.id, listing.title, marketPrice.estimatedValue, JSON.stringify(marketPrice.comparables));
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
