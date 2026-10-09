// ===== Flip profit model (tunables) =====
// Estimated cost of reselling nationally (eBay-level fees + average shipping).
export const RESALE_FEE_PCT = 0.13; // marketplace + payment fees, fraction of sale
export const SHIPPING_EST = 25; // flat shipping estimate in dollars
export const DRIVE_COST_PER_MILE = 0.65; // gas + wear, per mile (round trip counted)

// Estimated profit from buying at askingPrice and reselling at marketValue,
// minus the round-trip drive to pick it up when the distance is known.
// The same formula is inlined (via these constants) in routes/listings.ts SQL.
export function estimateProfit(
  marketValue: number,
  askingPrice: number,
  distanceMiles = 0
): number {
  return Math.round(
    marketValue * (1 - RESALE_FEE_PCT) -
      SHIPPING_EST -
      askingPrice -
      2 * distanceMiles * DRIVE_COST_PER_MILE
  );
}
