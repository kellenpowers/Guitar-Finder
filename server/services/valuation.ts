import {
  checkReverbPriceGuide,
  checkReverbAskingPrices,
  type PriceCheckResult,
} from "./reverb-checker.js";
import { fetchEbaySoldEstimate } from "../scrapers/ebay.js";

// Market value estimate, most-verifiable signal first:
// 1. eBay sold listings median (real sales, relevance-checked, any category)
// 2. Reverb price guide (real Reverb sales, but fuzzy-matched — music gear only)
// 3. Reverb asking prices (relevance-checked, but asking != selling) — last resort
export async function estimateValue(query: string): Promise<PriceCheckResult | null> {
  const sold = await fetchEbaySoldEstimate(query).catch(() => null);
  if (sold) return sold;

  const guide = await checkReverbPriceGuide(query);
  if (guide) return guide;

  return checkReverbAskingPrices(query);
}
