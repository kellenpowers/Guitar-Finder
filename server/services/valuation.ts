import {
  checkReverbPriceGuide,
  checkReverbAskingPrices,
  type PriceCheckResult,
} from "./reverb-checker.js";
import { fetchEbaySoldEstimate } from "../scrapers/ebay.js";

// Market value estimate, strongest signal first — real sales before asking prices:
// 1. Reverb price guide (actual completed Reverb sales; music gear)
// 2. eBay sold listings median (actual completed eBay sales; everything)
// 3. Reverb asking prices (what sellers want, not what buyers pay) — last resort
export async function estimateValue(query: string): Promise<PriceCheckResult | null> {
  const guide = await checkReverbPriceGuide(query);
  if (guide) return guide;

  const sold = await fetchEbaySoldEstimate(query).catch(() => null);
  if (sold) return sold;

  return checkReverbAskingPrices(query);
}
