import { checkPrice, type PriceCheckResult } from "./reverb-checker.js";
import { fetchEbaySoldEstimate } from "../scrapers/ebay.js";

// Market value estimate: Reverb's price data for music gear, falling back to
// the median of recently sold eBay listings for everything else.
export async function estimateValue(query: string): Promise<PriceCheckResult | null> {
  const reverb = await checkPrice(query);
  if (reverb) return reverb;
  return fetchEbaySoldEstimate(query).catch(() => null);
}
