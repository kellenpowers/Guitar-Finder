import * as cheerio from "cheerio";
import type { Scraper, ScrapedListing, ScraperOptions } from "./base.js";
import { citySlug } from "./facebook.js";

// Craigslist serves a server-rendered fallback (li.cl-static-search-result)
// that needs no login or JavaScript. The site subdomain (e.g. "austin" in
// austin.craigslist.org) comes from the CRAIGSLIST_SITE env var.

export function parseCraigslistHtml(html: string): ScrapedListing[] {
  const $ = cheerio.load(html);
  const listings: ScrapedListing[] = [];

  $("li.cl-static-search-result").each((_i, el) => {
    const card = $(el);
    const link = card.find("a").first();
    const href = link.attr("href") || "";
    const externalId = href.match(/\/(\d+)\.html/)?.[1] || "";
    const title = card.find(".title").text().trim() || card.attr("title") || "";
    const priceText = card.find(".price").text().trim();
    const price = parseFloat(priceText.replace(/[$,]/g, "")) || 0;
    const location = card.find(".location").text().trim();

    if (externalId && title) {
      listings.push({
        externalId,
        title,
        description: "",
        price,
        imageUrl: "",
        listingUrl: href,
        location,
        postedAt: null,
      });
    }
  });

  return listings;
}

export class CraigslistScraper implements Scraper {
  name = "craigslist";

  async scrape(options: ScraperOptions): Promise<ScrapedListing[]> {
    // Explicit env var wins; otherwise derive the site from the search's
    // location (most US cities match their craigslist subdomain).
    const site = process.env.CRAIGSLIST_SITE || citySlug(options.location);
    if (!site) {
      console.warn(
        "Skipping Craigslist: set a search location or CRAIGSLIST_SITE in .env " +
          "(the first part of your craigslist URL, e.g. 'savannah' for savannah.craigslist.org)."
      );
      return [];
    }

    const params = new URLSearchParams({ query: options.query, sort: "date" });
    if (options.maxPrice) params.set("max_price", String(Math.round(options.maxPrice)));

    const url = `https://${site}.craigslist.org/search/sss?${params.toString()}`;
    console.log(`Scraping Craigslist: ${url}`);

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      console.error(`Craigslist returned ${res.status} for ${url}`);
      return [];
    }

    const listings = parseCraigslistHtml(await res.text());
    console.log(`Found ${listings.length} listings on Craigslist`);
    return listings;
  }
}

export const craigslistScraper = new CraigslistScraper();
