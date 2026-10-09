import {
  checkReverbPriceGuide,
  checkReverbAskingPrices,
  type PriceCheckResult,
} from "./reverb-checker.js";
import { fetchEbaySoldEstimate } from "../scrapers/ebay.js";
import { normalizeQuery } from "./relevance.js";
import { getDb } from "../db/index.js";

// ===== Valuation cache tunables =====
// "Canon AE-1" isn't worth re-pricing hourly: cached values make most
// valuations free SQLite hits, so more items get scored per sweep with LESS
// load on eBay. Never use cache savings to justify scraping more often.
const CACHE_TTL_DAYS = 7;
const NEGATIVE_TTL_DAYS = 2; // hopeless titles stop burning lookup slots

export interface ValuationOutcome {
  result: PriceCheckResult | null;
  fromCache: boolean;
}

// Market value estimate, most-verifiable signal first:
// 1. eBay sold listings median (real sales, relevance-checked, any category)
// 2. Reverb price guide (real Reverb sales, relevance-guarded — music gear)
// 3. Reverb asking prices (relevance-checked, but asking != selling) — last resort
async function estimateFresh(query: string): Promise<PriceCheckResult | null> {
  const sold = await fetchEbaySoldEstimate(query).catch(() => null);
  if (sold) return sold;

  const guide = await checkReverbPriceGuide(query);
  if (guide) return guide;

  return checkReverbAskingPrices(query);
}

export async function estimateValue(title: string): Promise<ValuationOutcome> {
  const db = getDb();
  const query = normalizeQuery(title);
  if (!query) return { result: null, fromCache: true };

  const row = db
    .prepare("SELECT * FROM valuation_cache WHERE query = ?")
    .get(query) as any;
  if (row) {
    // checked_at comes from sqlite's datetime('now'), which is UTC
    const ageDays = (Date.now() - Date.parse(row.checked_at + "Z")) / 86_400_000;
    const ttl = row.estimated_value == null ? NEGATIVE_TTL_DAYS : CACHE_TTL_DAYS;
    if (ageDays >= 0 && ageDays < ttl) {
      return {
        fromCache: true,
        result:
          row.estimated_value == null
            ? null
            : {
                estimatedValue: row.estimated_value,
                comparables: JSON.parse(row.comparables || "[]"),
                source: row.value_source || "",
                salesPerWeek: row.sales_per_week,
              },
      };
    }
  }

  const result = await estimateFresh(query);
  db.prepare(`
    INSERT OR REPLACE INTO valuation_cache (query, estimated_value, value_source, sales_per_week, comparables, checked_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(
    query,
    result?.estimatedValue ?? null,
    result?.source ?? null,
    result?.salesPerWeek ?? null,
    JSON.stringify(result?.comparables ?? [])
  );
  return { result, fromCache: false };
}
