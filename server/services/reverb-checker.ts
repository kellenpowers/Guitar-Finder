export interface ReverbComparable {
  title: string;
  price: number;
  condition: string;
  url: string;
}

export interface PriceCheckResult {
  estimatedValue: number;
  comparables: ReverbComparable[];
}

const REVERB_API_BASE = "https://api.reverb.com/api";

// Set REVERB_API_TOKEN env var or replace this
function getToken(): string {
  const token = process.env.REVERB_API_TOKEN;
  if (!token) {
    throw new Error("REVERB_API_TOKEN environment variable is not set. Get one at https://reverb.com/my/api_settings");
  }
  return token;
}

export async function checkPrice(query: string): Promise<PriceCheckResult | null> {
  try {
    // First try the price guide
    const priceGuideResult = await fetchPriceGuide(query);
    if (priceGuideResult) return priceGuideResult;

    // Fall back to searching active listings
    return await fetchListingPrices(query);
  } catch (err) {
    console.error(`Reverb price check failed for "${query}":`, err);
    return null;
  }
}

async function fetchPriceGuide(query: string): Promise<PriceCheckResult | null> {
  const token = getToken();
  const params = new URLSearchParams({ query });
  const res = await fetch(`${REVERB_API_BASE}/priceguide?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/hal+json",
      Accept: "application/hal+json",
      "Accept-Version": "3.0",
    },
  });

  if (!res.ok) return null;

  const data = await res.json();
  const estimates = data?.estimates;
  if (!estimates || estimates.length === 0) return null;

  const topEstimate = estimates[0];
  const estimatedValue = topEstimate?.price_middle?.amount
    ? parseFloat(topEstimate.price_middle.amount)
    : null;

  if (!estimatedValue) return null;

  return {
    estimatedValue,
    comparables: [],
  };
}

async function fetchListingPrices(query: string): Promise<PriceCheckResult | null> {
  const token = getToken();
  const params = new URLSearchParams({
    query,
    per_page: "20",
    sort: "price|asc",
  });

  const res = await fetch(`${REVERB_API_BASE}/listings?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/hal+json",
      Accept: "application/hal+json",
      "Accept-Version": "3.0",
    },
  });

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

  // Use median price as estimated market value
  const prices = comparables.map((c) => c.price).filter((p) => p > 0).sort((a, b) => a - b);
  if (prices.length === 0) return null;

  const mid = Math.floor(prices.length / 2);
  const estimatedValue = prices.length % 2 === 0
    ? (prices[mid - 1] + prices[mid]) / 2
    : prices[mid];

  return { estimatedValue, comparables };
}
