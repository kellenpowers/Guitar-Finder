import type { Scraper, ScrapedListing, ScraperOptions } from "./base.js";

// Reverb has an official API — same token as the price checker.

export class ReverbScraper implements Scraper {
  name = "reverb";

  async scrape(options: ScraperOptions): Promise<ScrapedListing[]> {
    const token = process.env.REVERB_API_TOKEN;
    if (!token) {
      console.warn("Skipping Reverb source: REVERB_API_TOKEN is not set.");
      return [];
    }

    const params = new URLSearchParams({
      query: options.query,
      per_page: "50",
      sort: "published_at|desc",
    });
    if (options.maxPrice) params.set("price_max", String(Math.round(options.maxPrice)));

    const res = await fetch(`https://api.reverb.com/api/listings?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/hal+json",
        Accept: "application/hal+json",
        "Accept-Version": "3.0",
      },
    });
    if (!res.ok) {
      console.error(`Reverb API returned ${res.status}`);
      return [];
    }

    const data = await res.json();
    const listings: ScrapedListing[] = (data?.listings || [])
      .map((l: any) => ({
        externalId: String(l.id || ""),
        title: l.title || "",
        description: "",
        price: parseFloat(l.price?.amount || "0"),
        imageUrl: l.photos?.[0]?._links?.thumbnail?.href || "",
        listingUrl: l._links?.web?.href || "",
        location: l.shop?.name ? `Reverb: ${l.shop.name}` : "Reverb (shipped)",
        postedAt: l.published_at || null,
      }))
      .filter((l: ScrapedListing) => l.externalId && l.title && l.listingUrl);

    console.log(`Found ${listings.length} listings on Reverb`);
    return listings;
  }
}

export const reverbScraper = new ReverbScraper();
