export interface ReverbComparable {
  title: string;
  price: number;
  condition: string;
  url: string;
}

export interface PriceCheckResult {
  estimatedValue: number;
  comparables: ReverbComparable[];
  // Where the estimate came from: "reverb_price_guide" (real Reverb sales),
  // "ebay_sold" (real eBay sales), or "reverb_asking" (asking prices — weakest)
  source: string;
  // How often this item sells (per week), when the source's sale dates allow
  // computing it — currently only eBay sold data carries dates
  salesPerWeek?: number | null;
}

import { filterRelevant } from "./relevance.js";
import { trimOutliers, median } from "./stats.js";

const REVERB_API_BASE = "https://api.reverb.com/api";

// Fetch with one retry on rate-limiting; non-OK statuses are logged instead
// of silently swallowed.
async function reverbFetch(url: string, headers: Record<string, string>): Promise<any | null> {
  let res = await fetch(url, { headers });
  if (res.status === 429) {
    console.warn("Reverb API rate-limited — backing off 2s and retrying once.");
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(url, { headers });
  }
  if (!res.ok) {
    console.warn(`Reverb API returned ${res.status} for ${url.split("?")[0]}`);
    return null;
  }
  return res.json();
}

function reverbHeaders(): Record<string, string> | null {
  const token = process.env.REVERB_API_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/hal+json",
    Accept: "application/hal+json",
    "Accept-Version": "3.0",
  };
}

// Reverb's price guide is built from actual completed sales — the strongest signal
export async function checkReverbPriceGuide(query: string): Promise<PriceCheckResult | null> {
  const headers = reverbHeaders();
  if (!headers) return null;

  try {
    const params = new URLSearchParams({ query });
    const data = await reverbFetch(`${REVERB_API_BASE}/priceguide?${params}`, headers);
    const estimates = data?.estimates;
    if (!estimates || estimates.length === 0) return null;

    const topEstimate = estimates[0];
    const estimatedValue = topEstimate?.price_middle?.amount
      ? parseFloat(topEstimate.price_middle.amount)
      : null;

    if (!estimatedValue) return null;

    // The price guide fuzzy-matches: make sure the product it matched is
    // actually the item we asked about, or a wrong price gets stored silently
    const matchedTitle =
      topEstimate?.title || topEstimate?.product?.title || topEstimate?.model || "";
    if (matchedTitle && filterRelevant(query, [{ title: String(matchedTitle) }]).length === 0) {
      console.warn(
        `Reverb price guide matched "${matchedTitle}" for query "${query}" — not relevant, skipping.`
      );
      return null;
    }

    return { estimatedValue, comparables: [], source: "reverb_price_guide" };
  } catch (err) {
    console.error(`Reverb price guide check failed for "${query}":`, err);
    return null;
  }
}

// Median of current Reverb ASKING prices — a last resort, not real sales data
export async function checkReverbAskingPrices(query: string): Promise<PriceCheckResult | null> {
  const headers = reverbHeaders();
  if (!headers) return null;

  try {
    // Default (relevance) sort — sorting by price returns Reverb's cheapest
    // items sitewide when the query barely matches, which poisons the median
    const params = new URLSearchParams({ query, per_page: "20" });
    const data = await reverbFetch(`${REVERB_API_BASE}/listings?${params}`, headers);
    const listings = data?.listings;
    if (!listings || listings.length === 0) return null;

    const all: ReverbComparable[] = listings.map((l: any) => ({
      title: l.title || "",
      price: parseFloat(l.price?.amount || "0"),
      condition: l.condition?.display_name || "Unknown",
      url: l._links?.web?.href || "",
    }));

    // Reverb's search returns *something* for any query — a DJI camera query
    // comes back as random guitar parts. Keep only comps that match the item.
    const comparables = filterRelevant(query, all).slice(0, 10);

    const prices = trimOutliers(comparables.map((c) => c.price));
    if (prices.length < 3) return null; // too few matching listings to trust

    const estimatedValue = median(prices);
    if (estimatedValue == null) return null;

    return { estimatedValue, comparables, source: "reverb_asking" };
  } catch (err) {
    console.error(`Reverb asking-price check failed for "${query}":`, err);
    return null;
  }
}
