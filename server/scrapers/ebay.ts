import * as cheerio from "cheerio";
import type { Scraper, ScrapedListing, ScraperOptions } from "./base.js";
import { fetchRenderedHtml } from "./browser.js";
import { filterRelevant } from "../services/relevance.js";

// eBay's search results page needs no login, but eBay blocks plain HTTP
// fetches (403), so pages are loaded through the shared headless browser.

export function parseEbayHtml(html: string): ScrapedListing[] {
  const $ = cheerio.load(html);
  const listings: ScrapedListing[] = [];

  $(".s-item").each((_i, el) => {
    const card = $(el);
    const href = card.find(".s-item__link").attr("href") || "";
    const externalId = href.match(/\/itm\/(\d+)/)?.[1] || "";
    const title = card.find(".s-item__title").text().trim();
    // Price can be a range like "$100.00 to $150.00" — take the first number
    const priceText = card.find(".s-item__price").first().text();
    const priceMatch = priceText.replace(/,/g, "").match(/\d+(\.\d+)?/);
    const price = priceMatch ? parseFloat(priceMatch[0]) : 0;
    const imageUrl = card.find(".s-item__image img, .s-item__image-wrapper img").attr("src") || "";

    // Skip eBay's "Shop on eBay" placeholder card and cards without a real id
    if (!externalId || !title || /^shop on ebay$/i.test(title)) return;

    listings.push({
      externalId,
      title,
      description: "",
      price,
      imageUrl,
      listingUrl: `https://www.ebay.com/itm/${externalId}`,
      location: "eBay (shipped)",
      postedAt: null,
    });
  });

  return listings;
}

export class EbayScraper implements Scraper {
  name = "ebay";

  async scrape(options: ScraperOptions): Promise<ScrapedListing[]> {
    const params = new URLSearchParams({
      _nkw: options.query,
      _sop: "10", // newly listed first
      LH_BIN: "1", // Buy It Now only, so prices are comparable
    });
    if (options.maxPrice) params.set("_udhi", String(Math.round(options.maxPrice)));

    const url = `https://www.ebay.com/sch/i.html?${params.toString()}`;
    console.log(`Scraping eBay: ${url}`);

    const listings = parseEbayHtml(await fetchRenderedHtml(url));
    console.log(`Found ${listings.length} listings on eBay`);
    return listings;
  }
}

export const ebayScraper = new EbayScraper();

// Estimate market value from recently SOLD eBay listings (median price).
// Used as a valuation fallback for items Reverb doesn't cover (cameras, etc.).
export async function fetchEbaySoldEstimate(query: string): Promise<{
  estimatedValue: number;
  comparables: Array<{ title: string; price: number; condition: string; url: string }>;
  source: string;
} | null> {
  const params = new URLSearchParams({
    _nkw: query,
    LH_Sold: "1",
    LH_Complete: "1",
    _sop: "13", // most recently sold first
  });
  const url = `https://www.ebay.com/sch/i.html?${params.toString()}`;

  const html = await fetchRenderedHtml(url);
  const allSold = parseEbayHtml(html);
  if (allSold.length === 0) {
    const pageTitle = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "?";
    console.warn(`eBay sold search parsed 0 items (page title: "${pageTitle}")`);
  }

  // Drop "similar item" noise that doesn't actually match what we're valuing
  const sold = filterRelevant(query, allSold);
  const prices = sold.map((l) => l.price).filter((p) => p > 0).sort((a, b) => a - b);
  if (prices.length < 3) return null; // too few matching sales to trust

  const mid = Math.floor(prices.length / 2);
  const estimatedValue =
    prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];

  const comparables = sold.slice(0, 10).map((l) => ({
    title: l.title,
    price: l.price,
    condition: "Sold on eBay",
    url: l.listingUrl,
  }));

  return { estimatedValue, comparables, source: "ebay_sold" };
}
