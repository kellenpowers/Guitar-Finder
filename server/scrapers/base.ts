export interface ScrapedListing {
  externalId: string;
  title: string;
  description: string;
  price: number;
  imageUrl: string;
  listingUrl: string;
  location: string;
  postedAt: string | null;
}

export interface ScraperOptions {
  query: string;
  location: string;
  radiusMiles: number;
  maxPrice: number | null;
}

export interface Scraper {
  name: string;
  scrape(options: ScraperOptions): Promise<ScrapedListing[]>;
}
