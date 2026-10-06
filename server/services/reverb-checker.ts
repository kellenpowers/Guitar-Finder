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
}

const REVERB_API_BASE = "https://api.reverb.com/api";

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
    const res = await fetch(`${REVERB_API_BASE}/priceguide?${params}`, { headers });
    if (!res.ok) return null;

    const data = await res.json();
    const estimates = data?.estimates;
    if (!estimates || estimates.length === 0) return null;

    const topEstimate = estimates[0];
    const estimatedValue = topEstimate?.price_middle?.amount
      ? parseFloat(topEstimate.price_middle.amount)
      : null;

    if (!estimatedValue) return null;

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
    const params = new URLSearchParams({
      query,
      per_page: "20",
      sort: "price|asc",
    });
    const res = await fetch(`${REVERB_API_BASE}/listings?${params}`, { headers });
    if (!res.ok) return null;

    const data = await res.json();
    const listings = data?.listings;
    if (!listings || listings.length === 0) return null;

    const comparables: ReverbComparable[] = listings.slice(0, 10).map((l: any) => ({
      title: l.title || "",
      price: parseFloat(l.price?.amount || "0"),
      condition: l.condition?.display_name || "Unknown",
      url: l._links?.web?.href || "",
    }));

    const prices = comparables.map((c) => c.price).filter((p) => p > 0).sort((a, b) => a - b);
    if (prices.length === 0) return null;

    const mid = Math.floor(prices.length / 2);
    const estimatedValue = prices.length % 2 === 0
      ? (prices[mid - 1] + prices[mid]) / 2
      : prices[mid];

    return { estimatedValue, comparables, source: "reverb_asking" };
  } catch (err) {
    console.error(`Reverb asking-price check failed for "${query}":`, err);
    return null;
  }
}
