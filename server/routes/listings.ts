import { Router } from "express";
import { getDb } from "../db/index.js";

const router = Router();

router.get("/", (req, res) => {
  const db = getDb();
  const { searchId, source, minScore, sortBy } = req.query;

  let sql = `
    SELECT l.*,
      mp.estimated_market_value,
      CASE WHEN mp.estimated_market_value > 0
        THEN ROUND((mp.estimated_market_value - l.price) / mp.estimated_market_value * 100, 1)
        ELSE NULL
      END as deal_score,
      CASE WHEN mp.estimated_market_value > 0
        THEN ROUND(mp.estimated_market_value - l.price, 2)
        ELSE NULL
      END as savings
    FROM listings l
    LEFT JOIN (
      SELECT listing_id, estimated_market_value,
        ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY checked_at DESC) as rn
      FROM market_prices
    ) mp ON mp.listing_id = l.id AND mp.rn = 1
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (searchId) {
    sql += " AND l.search_id = ?";
    params.push(searchId);
  }
  if (source) {
    sql += " AND l.source = ?";
    params.push(source);
  }
  if (minScore) {
    sql += ` AND CASE WHEN mp.estimated_market_value > 0
      THEN (mp.estimated_market_value - l.price) / mp.estimated_market_value * 100
      ELSE 0 END >= ?`;
    params.push(Number(minScore));
  }

  if (sortBy === "score") {
    sql += " ORDER BY deal_score DESC NULLS LAST";
  } else if (sortBy === "price") {
    sql += " ORDER BY l.price ASC";
  } else {
    sql += " ORDER BY l.scraped_at DESC";
  }

  sql += " LIMIT 100";

  const listings = db.prepare(sql).all(...params);
  res.json(listings);
});

router.get("/:id", (req, res) => {
  const db = getDb();
  const listing = db.prepare(`
    SELECT l.*,
      mp.estimated_market_value,
      mp.reverb_listings,
      CASE WHEN mp.estimated_market_value > 0
        THEN ROUND((mp.estimated_market_value - l.price) / mp.estimated_market_value * 100, 1)
        ELSE NULL
      END as deal_score
    FROM listings l
    LEFT JOIN (
      SELECT listing_id, estimated_market_value, reverb_listings,
        ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY checked_at DESC) as rn
      FROM market_prices
    ) mp ON mp.listing_id = l.id AND mp.rn = 1
    WHERE l.id = ?
  `).get(req.params.id);
  if (!listing) return res.status(404).json({ error: "Not found" });
  res.json(listing);
});

export default router;
