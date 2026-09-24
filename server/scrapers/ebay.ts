import * as cheerio from "cheerio";
import type { Scraper, ScrapedListing, ScraperOptions } from "./base.js";

// eBay's search results page is server-rendered and needs no login.

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
    const price = parseFloat(priceText.replace(/[^0-9.]+/g, " ").trim().split(" ")[0]) || 0;
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

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      console.error(`eBay returned ${res.status} for ${url}`);
      return [];
    }

    const listings = parseEbayHtml(await res.text());
    console.log(`Found ${listings.length} listings on eBay`);
    return listings;
  }
}

export const ebayScraper = new EbayScraper();
