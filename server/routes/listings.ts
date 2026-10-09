import { Router } from "express";
import { getDb } from "../db/index.js";
import { RESALE_FEE_PCT, SHIPPING_EST, DRIVE_COST_PER_MILE } from "../services/profit.js";
import {
  W_PROFIT, W_ROI, W_VELOCITY, W_CONFIDENCE, W_DISTANCE,
  PROFIT_FULL_MARKS, ROI_FULL_MARKS, VELOCITY_FULL_MARKS, VELOCITY_UNKNOWN,
  DRIVE_NEAR_MINUTES, DRIVE_FAR_MINUTES, DISTANCE_UNKNOWN,
  SOURCE_CONFIDENCE, SOURCE_CONFIDENCE_DEFAULT,
} from "../services/flip-score.js";

const router = Router();

// SQL mirror of services/flip-score.ts computeFlipScore and
// services/profit.ts estimateProfit, built from the same constants so there
// is one set of tunables
const PROFIT_EXPR = `(mp.estimated_market_value * ${1 - RESALE_FEE_PCT} - ${SHIPPING_EST} - l.price - COALESCE(l.distance_miles, 0) * ${2 * DRIVE_COST_PER_MILE})`;
const DISTANCE_EXPR = `(CASE WHEN l.drive_minutes IS NULL THEN ${DISTANCE_UNKNOWN}
  ELSE MIN(MAX((${DRIVE_FAR_MINUTES} - l.drive_minutes) / ${DRIVE_FAR_MINUTES - DRIVE_NEAR_MINUTES}.0, 0), 1) END)`;
const FLIP_SCORE_EXPR = `
      CASE
        WHEN mp.estimated_market_value > 0 AND ${PROFIT_EXPR} <= 0 THEN 0
        WHEN mp.estimated_market_value > 0 THEN ROUND(100 * (
          ${W_PROFIT} * MIN(${PROFIT_EXPR} / ${PROFIT_FULL_MARKS}.0, 1) +
          ${W_ROI} * MIN(${PROFIT_EXPR} / MAX(l.price, 1) / ${ROI_FULL_MARKS}, 1) +
          ${W_VELOCITY} * (CASE WHEN mp.sales_per_week IS NULL THEN ${VELOCITY_UNKNOWN}
                           ELSE MIN(mp.sales_per_week / ${VELOCITY_FULL_MARKS}.0, 1) END) +
          ${W_CONFIDENCE} * (CASE mp.value_source
                             WHEN 'ebay_sold' THEN ${SOURCE_CONFIDENCE.ebay_sold}
                             WHEN 'reverb_price_guide' THEN ${SOURCE_CONFIDENCE.reverb_price_guide}
                             WHEN 'reverb_asking' THEN ${SOURCE_CONFIDENCE.reverb_asking}
                             ELSE ${SOURCE_CONFIDENCE_DEFAULT} END) +
          ${W_DISTANCE} * ${DISTANCE_EXPR}
        ))
        ELSE NULL
      END`;

router.get("/", (req, res) => {
  const db = getDb();
  const { searchId, source, minScore, sortBy } = req.query;

  let sql = `
    SELECT l.*,
      mp.estimated_market_value,
      mp.value_source,
      mp.sales_per_week,
      CASE WHEN mp.estimated_market_value > 0
        THEN ROUND((mp.estimated_market_value - l.price) / mp.estimated_market_value * 100, 1)
        ELSE NULL
      END as deal_score,
      CASE WHEN mp.estimated_market_value > 0
        THEN ROUND(mp.estimated_market_value - l.price, 2)
        ELSE NULL
      END as savings,
      CASE WHEN mp.estimated_market_value > 0
        THEN ROUND(${PROFIT_EXPR})
        ELSE NULL
      END as est_profit,
      ${FLIP_SCORE_EXPR} as flip_score
    FROM listings l
    LEFT JOIN (
      SELECT listing_id, estimated_market_value, value_source, sales_per_week,
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

  if (sortBy === "flip") {
    sql += " ORDER BY flip_score DESC NULLS LAST";
  } else if (sortBy === "profit") {
    sql += " ORDER BY est_profit DESC NULLS LAST";
  } else if (sortBy === "score") {
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
      mp.value_source,
      mp.sales_per_week,
      mp.reverb_listings,
      CASE WHEN mp.estimated_market_value > 0
        THEN ROUND((mp.estimated_market_value - l.price) / mp.estimated_market_value * 100, 1)
        ELSE NULL
      END as deal_score
    FROM listings l
    LEFT JOIN (
      SELECT listing_id, estimated_market_value, value_source, sales_per_week, reverb_listings,
        ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY checked_at DESC) as rn
      FROM market_prices
    ) mp ON mp.listing_id = l.id AND mp.rn = 1
    WHERE l.id = ?
  `).get(req.params.id);
  if (!listing) return res.status(404).json({ error: "Not found" });
  res.json(listing);
});

export default router;
