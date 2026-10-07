import * as cheerio from "cheerio";
import type { Scraper, ScrapedListing, ScraperOptions } from "./base.js";
import { citySlug } from "./facebook.js";
import { fetchRenderedHtml, pageTitleOf } from "./browser.js";

// Craigslist serves a server-rendered fallback (li.cl-static-search-result)
// that needs no login or JavaScript. The site subdomain (e.g. "austin" in
// austin.craigslist.org) comes from the CRAIGSLIST_SITE env var.

export function parseCraigslistHtml(html: string): ScrapedListing[] {
  const $ = cheerio.load(html);
  const byId = new Map<string, ScrapedListing>();

  // Craigslist has several markups: the no-JS fallback (cl-static-search-result),
  // the rendered app (cl-search-result), and gallery cards. Handle all of them,
  // on any tag.
  $(".cl-static-search-result, .cl-search-result, .gallery-card").each((_i, el) => {
    const card = $(el);
    const href =
      card.find("a[href*='.html']").first().attr("href") ||
      card.find("a").first().attr("href") ||
      "";
    const externalId = href.match(/\/(\d+)\.html/)?.[1] || "";
    if (!externalId || byId.has(externalId)) return;

    const title =
      card.attr("title") ||
      card
        .find(".title, .titlestring, .posting-title .label, .cl-app-anchor .label")
        .first()
        .text()
        .trim();
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
    return fetchAndParse(url);
  }
}

// Browse a craigslist section (e.g. "ela" = electronics) newest-first — used
// by discovery sweeps. Section codes: https://<site>.craigslist.org/search/<code>
export async function scrapeCraigslistSection(
  site: string,
  section: string
): Promise<ScrapedListing[]> {
  const url = `https://${site}.craigslist.org/search/${section}?sort=date`;
  console.log(`Scraping Craigslist section: ${url}`);
  return fetchAndParse(url);
}

// Results render via JavaScript — wait for them, and when none appear say
// what page Craigslist actually served so the failure is diagnosable.
const RESULT_SELECTORS = ".cl-search-result, .cl-static-search-result, .gallery-card";

async function fetchAndParse(url: string): Promise<ScrapedListing[]> {
  const html = await fetchRenderedHtml(url, 1500, RESULT_SELECTORS);
  const listings = parseCraigslistHtml(html);
  if (listings.length === 0) {
    const postingLinks = (html.match(/\/d\/[^"]*\/\d+\.html/g) || []).length;
    console.warn(
      `Craigslist returned 0 parseable results (page title: "${pageTitleOf(html)}", ` +
        `posting links in page: ${postingLinks}) — ` +
        (postingLinks > 0
          ? "markup changed, parser needs updating."
          : "likely a bot check, wrong site subdomain, or genuinely no results.")
    );
  } else {
    console.log(`Found ${listings.length} listings on Craigslist`);
  }
  return listings;
}

export const craigslistScraper = new CraigslistScraper();
