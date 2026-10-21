// ===== Platform fee model (tunables) =====
// Used to price the SAME item on different platforms so the owner NETS the
// same amount after each platform's cut. Calibrated against the owner's real
// Reverb sales (tracker, Oct 2026).
//
// Both platforms are "marketplace facilitators": they collect and remit the
// buyer's sales tax themselves (the owner never files sales tax for these
// sales) — BUT their percentage fees apply to the tax-INCLUSIVE total, so the
// effective rate runs a bit above the sticker rate.
const AVG_BUYER_TAX = 0.07; // typical buyer's state sales tax

// Reverb: 5% selling fee + 3.19% payment processing (on the taxed total) + $0.49
export const REVERB_FEE_PCT = 0.05 + 0.0319 * (1 + AVG_BUYER_TAX); // ≈ 8.41%
export const REVERB_FEE_FIXED = 0.49;

// eBay: 13.25% final value fee (most gear categories, incl. payments), charged
// on the taxed total, + $0.40 per order
export const EBAY_FEE_PCT = 0.1325 * (1 + AVG_BUYER_TAX); // ≈ 14.18%
export const EBAY_FEE_FIXED = 0.4;

// What the owner actually pockets from a Reverb sale at this price
export function reverbNet(price: number): number {
  return price * (1 - REVERB_FEE_PCT) - REVERB_FEE_FIXED;
}

// Price to ask on eBay so the net matches netting `reverbPrice` on Reverb.
// Rounded up to a .99 ending.
export function ebayPriceMatchingReverbNet(reverbPrice: number): number {
  const net = reverbNet(reverbPrice);
  const raw = (net + EBAY_FEE_FIXED) / (1 - EBAY_FEE_PCT);
  return Math.ceil(raw) - 0.01;
}

// Price to ask on a platform to net a target dollar amount.
export function priceToNet(targetNet: number, feePct: number, feeFixed = 0): number {
  return Math.ceil((targetNet + feeFixed) / (1 - feePct)) - 0.01;
}
