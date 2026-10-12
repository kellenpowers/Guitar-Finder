// ===== Platform fee model (tunables) =====
// Used to price the SAME item on different platforms so the owner NETS the
// same amount after each platform's cut.
// Reverb: ~5% selling fee + ~2.7% payment processing.
export const REVERB_FEE_PCT = 0.077;
// eBay: typical final value fee incl. payment processing. Category-dependent
// (musical instruments run lower, ~6-7%); this default is the common rate.
export const EBAY_FEE_PCT = 0.1325;

// Price to ask on eBay so the net matches netting `reverbPrice` on Reverb.
// Rounded up to a .99 ending.
export function ebayPriceMatchingReverbNet(reverbPrice: number): number {
  const net = reverbPrice * (1 - REVERB_FEE_PCT);
  const raw = net / (1 - EBAY_FEE_PCT);
  return Math.ceil(raw) - 0.01;
}

// Price to ask on a platform to net a target dollar amount.
export function priceToNet(targetNet: number, feePct: number): number {
  return Math.ceil(targetNet / (1 - feePct)) - 0.01;
}
