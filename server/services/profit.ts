// ===== Flip profit model (tunables) =====
// Estimated cost of reselling nationally (eBay-level fees + average shipping).
export const RESALE_FEE_PCT = 0.13; // marketplace + payment fees, fraction of sale
export const SHIPPING_EST = 25; // flat shipping estimate in dollars

// Estimated profit from buying at askingPrice and reselling at marketValue.
// The same formula is inlined (via these constants) in routes/listings.ts SQL.
export function estimateProfit(marketValue: number, askingPrice: number): number {
  return Math.round(marketValue * (1 - RESALE_FEE_PCT) - SHIPPING_EST - askingPrice);
}
