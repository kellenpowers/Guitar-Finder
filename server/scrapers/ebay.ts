import * as cheerio from "cheerio";
import type { Scraper, ScrapedListing, ScraperOptions } from "./base.js";
import { fetchRenderedHtml, pageTitleOf } from "./browser.js";
import { filterRelevant } from "../services/relevance.js";
import { trimOutliers, median } from "../services/stats.js";

// Load an eBay page, waiting for result cards; if eBay serves its bot-check
// "Error Page", back off and retry once before giving up.
async function fetchEbayHtml(url: string): Promise<string> {
  let html = await fetchRenderedHtml(url, 2000, ".s-item");
  if (pageTitleOf(html).includes("Error Page")) {
    console.warn("eBay served its error page (bot check) — retrying once...");
    await new Promise((r) => setTimeout(r, 4000 + Math.random() * 3000));
    html = await fetchRenderedHtml(url, 2000, ".s-item");
  }
  return html;
}

// ===== Official Browse API (used automatically when EBAY_CLIENT_ID /
// EBAY_CLIENT_SECRET are set in .env; falls back to scraping on any failure,
// e.g. if eBay hasn't enabled production buy scopes for this keyset yet) =====

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getEbayAppToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }
  const basic = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body:
      "grant_type=client_credentials&scope=" +
      encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) {
    throw new Error(`eBay token mint failed (${res.status}): ${(await res.text()).slice(0, 150)}`);
  }
  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
  };
  return cachedToken.value;
}

// Pure mapper from a Browse API itemSummary to our listing shape.
// legacyItemId keeps dedupe continuity with previously scraped /itm/ ids.
export function mapBrowseItem(item: any): ScrapedListing | null {
  const externalId =
    String(item?.legacyItemId || "").trim() ||
    String(item?.itemId || "").split("|")[1] ||
    "";
  const title = (item?.title || "").trim();
  const price = parseFloat(item?.price?.value || "0");
  if (!externalId || !title || !(price > 0)) return null;
  return {
    externalId,
    title,
    description: "",
    price,
    imageUrl: item?.image?.imageUrl || item?.thumbnailImages?.[0]?.imageUrl || "",
    listingUrl: item?.itemWebUrl || `https://www.ebay.com/itm/${externalId}`,
    location: "eBay (shipped)",
    postedAt: item?.itemCreationDate || null,
  };
}

async function browseSearch(options: ScraperOptions): Promise<ScrapedListing[]> {
  const token = await getEbayAppToken();
  const filters = ["buyingOptions:{FIXED_PRICE}", "priceCurrency:USD"];
  if (options.maxPrice) filters.push(`price:[..${Math.round(options.maxPrice)}]`);
  const params = new URLSearchParams({
    q: options.query,
    sort: "newlyListed",
    limit: "50",
    filter: filters.join(","),
  });
  const res = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    }
  );
  if (!res.ok) {
    throw new Error(`Browse API ${res.status}: ${(await res.text()).slice(0, 150)}`);
  }
  const items = (await res.json())?.itemSummaries || [];
  const listings = items.map(mapBrowseItem).filter(Boolean) as ScrapedListing[];
  console.log(`Found ${listings.length} listings on eBay (official API)`);
  return listings;
}

// eBay's search results page needs no login, but eBay blocks plain HTTP
// fetches (403), so pages are loaded through the shared headless browser.

// How often this item sells, from the timestamps of its recent sales.
// Needs at least 3 dated sales; returns sales per week, one decimal.
export function computeSalesPerWeek(timestamps: number[]): number | null {
  const valid = timestamps.filter((t) => Number.isFinite(t));
  if (valid.length < 3) return null;
  const spanDays = Math.max((Math.max(...valid) - Math.min(...valid)) / 86_400_000, 1);
  return Math.round((valid.length / spanDays) * 7 * 10) / 10;
}

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

    // On sold-listings pages the caption carries "Sold  Oct 5, 2026"
    const captionText = card.find(".s-item__caption").text();
    const soldMatch = captionText.match(/sold\s+([a-z]{3,9}\s+\d{1,2},\s+\d{4})/i);
    const soldDate = soldMatch ? new Date(soldMatch[1]) : null;
    const postedAt =
      soldDate && !isNaN(soldDate.getTime()) ? soldDate.toISOString() : null;

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
      postedAt, // the sold date on sold-listings pages, null on active searches
    });
  });

  return listings;
}

export class EbayScraper implements Scraper {
  name = "ebay";

  async scrape(options: ScraperOptions): Promise<ScrapedListing[]> {
    if (process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET) {
      try {
        return await browseSearch(options);
      } catch (err) {
        console.warn(
          `eBay API failed (${err instanceof Error ? err.message : err}) — falling back to page scrape.`
        );
      }
    }

    const params = new URLSearchParams({
      _nkw: options.query,
      _sop: "10", // newly listed first
      LH_BIN: "1", // Buy It Now only, so prices are comparable
    });
    if (options.maxPrice) params.set("_udhi", String(Math.round(options.maxPrice)));

    const url = `https://www.ebay.com/sch/i.html?${params.toString()}`;
    console.log(`Scraping eBay: ${url}`);

    const html = await fetchEbayHtml(url);
    const listings = parseEbayHtml(html);
    if (listings.length === 0) {
      console.warn(`eBay search parsed 0 items (page title: "${pageTitleOf(html)}")`);
    } else {
      console.log(`Found ${listings.length} listings on eBay`);
    }
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
  salesPerWeek: number | null;
} | null> {
  const params = new URLSearchParams({
    _nkw: query,
    LH_Sold: "1",
    LH_Complete: "1",
    _sop: "13", // most recently sold first
  });
  const url = `https://www.ebay.com/sch/i.html?${params.toString()}`;

  const html = await fetchEbayHtml(url);
  const allSold = parseEbayHtml(html);
  if (allSold.length === 0) {
    console.warn(`eBay sold search parsed 0 items (page title: "${pageTitleOf(html)}")`);
  }

  // Drop "similar item" noise that doesn't actually match what we're valuing,
  // then outlier sales (parts-only cheapies, inflated bundles) before the median
  const sold = filterRelevant(query, allSold);
  const prices = trimOutliers(sold.map((l) => l.price));
  if (prices.length < 3) return null; // too few matching sales to trust

  const estimatedValue = median(prices);
  if (estimatedValue == null) return null;

  const comparables = sold.slice(0, 10).map((l) => ({
    title: l.title,
    price: l.price,
    condition: l.postedAt
      ? `Sold ${new Date(l.postedAt).toLocaleDateString()}`
      : "Sold on eBay",
    url: l.listingUrl,
  }));

  const salesPerWeek = computeSalesPerWeek(
    sold.map((l) => (l.postedAt ? Date.parse(l.postedAt) : NaN))
  );

  return { estimatedValue, comparables, source: "ebay_sold", salesPerWeek };
}
