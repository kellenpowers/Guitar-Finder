// ===== The owner's margin doctrine (tunables) =====
// A flip must return at least 100% on the cash laid out; cheap items must
// return 200%, because small absolute profits don't pay for the time.
export const MARGIN_BREAKPOINT = 100; // "cheap item" threshold in dollars
export const BASE_MARGIN = 1.0; // 100% ROI at or above the breakpoint
export const SMALL_ITEM_MARGIN = 2.0; // 200% ROI below it

// Minimum estimated profit for a listing at this asking price to qualify
export function requiredProfit(price: number): number {
  return price * (price < MARGIN_BREAKPOINT ? SMALL_ITEM_MARGIN : BASE_MARGIN);
}

export function meetsMarginTarget(l: {
  price: number;
  est_profit?: number | null;
}): boolean {
  if (l.est_profit == null) return false;
  return l.est_profit >= requiredProfit(l.price);
}

// Highest buy price that still meets the margin, given the net proceeds a
// resale would bring in (market value minus fees, shipping, drive):
// profit = net - pay >= margin * pay  =>  pay <= net / (1 + margin)
export function maxBuyPrice(netProceeds: number): number {
  const at100 = netProceeds / (1 + BASE_MARGIN);
  if (at100 >= MARGIN_BREAKPOINT) return at100;
  return netProceeds / (1 + SMALL_ITEM_MARGIN);
}

// ===== Platform fees (mirror of server/services/fees.ts) =====
const AVG_BUYER_TAX = 0.07;
const REVERB_FEE_PCT = 0.05 + 0.0319 * (1 + AVG_BUYER_TAX); // ≈ 8.41%
const REVERB_FEE_FIXED = 0.49;
const EBAY_FEE_PCT = 0.1325 * (1 + AVG_BUYER_TAX); // ≈ 14.18%
const EBAY_FEE_FIXED = 0.4;
const MIN_AUTO_PRICE = 20; // mirror of server/services/pricing.ts

// Lowest asking price that still clears the margin doctrine after fees — the
// repricing autopilot's floor (mirror of server/services/pricing.ts). Items
// with a Reverb listing floor on Reverb fees (their eBay ask is fee-matched
// above the Reverb price); eBay-only items must clear eBay's bigger cut.
export function marginFloorPrice(boughtPrice: number, platform: "reverb" | "ebay" = "reverb"): number {
  const pct = platform === "ebay" ? EBAY_FEE_PCT : REVERB_FEE_PCT;
  const fixed = platform === "ebay" ? EBAY_FEE_FIXED : REVERB_FEE_FIXED;
  const targetNet = boughtPrice + requiredProfit(boughtPrice);
  return Math.max(MIN_AUTO_PRICE, Math.round(Math.ceil((targetNet + fixed) / (1 - pct)) - 0.01));
}
