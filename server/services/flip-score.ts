// ===== Flip Score tunables =====
// One 0-100 number for "how good is this flip", combining:
export const W_PROFIT = 0.45; // estimated profit dollars (already drive-cost-adjusted)
export const W_ROI = 0.15; // profit relative to cash laid out
export const W_VELOCITY = 0.2; // how fast it sells
export const W_CONFIDENCE = 0.1; // quality of the value estimate
export const W_DISTANCE = 0.1; // how far the pickup drive is (time cost)

export const PROFIT_FULL_MARKS = 300; // $300+ profit maxes the profit part
export const ROI_FULL_MARKS = 1.0; // 100% return maxes the ROI part
export const VELOCITY_FULL_MARKS = 3; // 3+ sales/week maxes the velocity part
export const VELOCITY_UNKNOWN = 0.5; // neutral when sale dates are unavailable
export const DISTANCE_NEAR = 15; // within this many miles = full marks
export const DISTANCE_FAR = 120; // at/beyond this = zero (a 2h+ drive each way)
export const DISTANCE_UNKNOWN = 0.7; // shipped or unknown location

// How much to trust each valuation source
export const SOURCE_CONFIDENCE: Record<string, number> = {
  ebay_sold: 1.0,
  reverb_price_guide: 0.8,
  reverb_asking: 0.4,
};
export const SOURCE_CONFIDENCE_DEFAULT = 0.5;

export interface FlipScoreInput {
  estProfit: number | null;
  price: number;
  salesPerWeek: number | null;
  valueSource: string | null;
  distanceMiles?: number | null;
}

export function distancePart(miles: number | null | undefined): number {
  if (miles == null) return DISTANCE_UNKNOWN;
  return Math.min(Math.max((DISTANCE_FAR - miles) / (DISTANCE_FAR - DISTANCE_NEAR), 0), 1);
}

// The same formula is inlined (via these constants) in routes/listings.ts SQL.
export function computeFlipScore(input: FlipScoreInput): number | null {
  if (input.estProfit == null) return null; // no market value -> no score
  if (input.estProfit <= 0) return 0;

  const profitPart = Math.min(input.estProfit / PROFIT_FULL_MARKS, 1);
  const roiPart = Math.min(input.estProfit / Math.max(input.price, 1) / ROI_FULL_MARKS, 1);
  const velocityPart =
    input.salesPerWeek == null
      ? VELOCITY_UNKNOWN
      : Math.min(input.salesPerWeek / VELOCITY_FULL_MARKS, 1);
  const confidencePart =
    (input.valueSource && SOURCE_CONFIDENCE[input.valueSource]) || SOURCE_CONFIDENCE_DEFAULT;

  return Math.round(
    100 *
      (W_PROFIT * profitPart +
        W_ROI * roiPart +
        W_VELOCITY * velocityPart +
        W_CONFIDENCE * confidencePart +
        W_DISTANCE * distancePart(input.distanceMiles))
  );
}
