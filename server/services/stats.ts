// Robust price statistics for comp sets.

// Drop prices outside 1.5x the interquartile range — one "$1 manual only"
// sale or a "$3000 bundle" stops skewing a small comp set.
export function trimOutliers(prices: number[]): number[] {
  const sorted = prices.filter((p) => p > 0).sort((a, b) => a - b);
  if (sorted.length < 4) return sorted; // too few points to judge outliers
  const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
  const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return sorted.filter((p) => p >= lo && p <= hi);
}

export function median(sortedPrices: number[]): number | null {
  if (sortedPrices.length === 0) return null;
  const mid = Math.floor(sortedPrices.length / 2);
  return sortedPrices.length % 2 === 0
    ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2
    : sortedPrices[mid];
}
