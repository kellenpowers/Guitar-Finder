import * as cheerio from "cheerio";
import type { Scraper, ScrapedListing, ScraperOptions } from "./base.js";
import { citySlug } from "./facebook.js";
import { fetchRenderedHtml } from "./browser.js";

// Craigslist serves a server-rendered fallback (li.cl-static-search-result)
// that needs no login or JavaScript. The site subdomain (e.g. "austin" in
// austin.craigslist.org) comes from the CRAIGSLIST_SITE env var.

export function parseCraigslistHtml(html: string): ScrapedListing[] {
  const $ = cheerio.load(html);
  const byId = new Map<string, ScrapedListing>();

  // Craigslist has two markups: the no-JS fallback (cl-static-search-result)
  // and the rendered app (cl-search-result). Handle both.
  $("li.cl-static-search-result, li.cl-search-result").each((_i, el) => {
    const card = $(el);
    const href =
      card.find("a[href*='.html']").first().attr("href") ||
      card.find("a").first().attr("href") ||
      "";
    const externalId = href.match(/\/(\d+)\.html/)?.[1] || "";
    if (!externalId || byId.has(externalId)) return;

    const title =
      card.attr("title") ||
      card.find(".title, .posting-title .label, .cl-app-anchor .label").first().text().trim();
    const priceText = card.find(".price, .priceinfo").first().text().trim();
    const price = parseFloat(priceText.replace(/[$,]/g, "")) || 0;
    const location = card.find(".location, .meta .separator + span").first().text().trim();
    const imageUrl = card.find("img").first().attr("src") || "";

    if (title) {
      byId.set(externalId, {
        externalId,
        title,
        description: "",
        price,
        imageUrl,
        listingUrl: href,
        location,
        postedAt: null,
      });
    }
  });

  return [...byId.values()];
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

    const listings = parseCraigslistHtml(await fetchRenderedHtml(url));
    console.log(`Found ${listings.length} listings on Craigslist`);
    return listings;
  }
}

export const craigslistScraper = new CraigslistScraper();
