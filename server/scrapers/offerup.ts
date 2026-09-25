import { chromium } from "playwright";
import type { Scraper, ScrapedListing, ScraperOptions } from "./base.js";
import { parseCardLines } from "./facebook.js";

// OfferUp needs a real browser (JavaScript-rendered) but no login.
// Results are localized by IP, which is the user's home connection.

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise((r) => setTimeout(r, ms));
}

export class OfferUpScraper implements Scraper {
  name = "offerup";

  async scrape(options: ScraperOptions): Promise<ScrapedListing[]> {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      });
      const page = await context.newPage();

      const params = new URLSearchParams({ q: options.query });
      if (options.maxPrice) params.set("price_max", String(Math.round(options.maxPrice)));
      const url = `https://offerup.com/search?${params.toString()}`;
      console.log(`Scraping OfferUp: ${url}`);

      await page.goto(url, { waitUntil: "domcontentloaded" });
      // OfferUp renders results with JavaScript — wait for item links to appear
      await page.waitForSelector("a[href*='/item/']", { timeout: 15_000 }).catch(() => {});
      await randomDelay(1500, 3000);
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 1200);
        await randomDelay(800, 1500);
      }

      let anchors = await page.$$("a[href*='/item/detail/']");
      if (anchors.length === 0) {
        anchors = await page.$$("a[href^='/item/']");
      }
      if (anchors.length === 0) {
        const title = await page.title().catch(() => "?");
        console.warn(
          `No OfferUp item links found (page title: "${title}") — ` +
            "OfferUp may be showing a bot check or changed its layout."
        );
      }

      const byId = new Map<string, ScrapedListing>();
      for (const anchor of anchors) {
        try {
          const href = await anchor.getAttribute("href");
          if (!href) continue;
          // URLs look like /item/detail/<id-or-slug>
          const externalId =
            href.match(/\/item\/detail\/([^/?#]+)/)?.[1] ||
            href.match(/\/item\/([^/?#]+)/)?.[1] ||
            "";
          if (externalId === "detail") continue;
          if (!externalId || byId.has(externalId)) continue;

          const text = (await anchor.innerText()) || "";
          const parsed = parseCardLines(text.split("\n"));
          if (!parsed) continue;

          const imgEl = await anchor.$("img");
          const imageUrl = imgEl ? (await imgEl.getAttribute("src")) || "" : "";

          byId.set(externalId, {
            externalId,
            title: parsed.title,
            description: "",
            price: parsed.price,
            imageUrl,
            listingUrl: `https://offerup.com/item/detail/${externalId}`,
            location: parsed.location,
            postedAt: null,
          });
        } catch {
          // Skip cards that fail to parse
        }
      }

      const listings = [...byId.values()];
      console.log(`Found ${listings.length} listings on OfferUp`);
      return listings;
    } finally {
      await browser.close();
    }
  }
}

export const offerUpScraper = new OfferUpScraper();
