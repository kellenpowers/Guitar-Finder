export interface DealScore {
  dealScore: number;     // 0-100, higher = better deal
  savings: number;       // dollar amount saved
  savingsPercent: number; // percentage saved
}

export function scoreDeal(listingPrice: number, marketValue: number): DealScore | null {
  if (marketValue <= 0 || listingPrice < 0) return null;

  const savings = marketValue - listingPrice;
  const savingsPercent = (savings / marketValue) * 100;
  const dealScore = Math.max(0, Math.min(100, Math.round(savingsPercent)));

  return {
    dealScore,
    savings: Math.round(savings * 100) / 100,
    savingsPercent: Math.round(savingsPercent * 10) / 10,
  };
}
