export interface SavedSearch {
  id: number;
  name: string;
  query: string;
  category: string;
  maxPrice: number | null;
  minDealScore: number;
  location: string;
  radiusMiles: number;
  isActive: boolean;
  cronSchedule: string;
  createdAt: string;
  updatedAt: string;
}

export interface Listing {
  id: number;
  searchId: number;
  source: "facebook" | "craigslist";
  externalId: string;
  title: string;
  description: string;
  price: number;
  imageUrl: string;
  listingUrl: string;
  location: string;
  postedAt: string | null;
  scrapedAt: string;
}

export interface MarketPrice {
  id: number;
  listingId: number;
  query: string;
  estimatedMarketValue: number;
  reverbListings: string; // JSON string
  checkedAt: string;
}

export interface ListingWithDeal extends Listing {
  estimatedMarketValue: number | null;
  dealScore: number | null;
  savings: number | null;
  savingsPercent: number | null;
}
