import { chromium, type Browser, type BrowserContext } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Scraper, ScrapedListing, ScraperOptions } from "./base.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_PATH = path.join(__dirname, "..", "data", "fb-cookies.json");

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise((r) => setTimeout(r, ms));
}

export class FacebookMarketplaceScraper implements Scraper {
  name = "facebook";
  private browser: Browser | null = null;

  async login(): Promise<void> {
    console.log("Opening browser for Facebook login...");
    console.log("Please log in manually. The browser will stay open for 2 minutes.");

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("https://www.facebook.com/login");

    // Wait for the user to log in (detect navigation to facebook.com home)
    try {
      await page.waitForURL("**/facebook.com/**", { timeout: 120_000 });
      // Give extra time to complete any redirects
      await randomDelay(3000, 5000);
    } catch {
      console.log("Login timeout — saving cookies anyway.");
    }

    const cookies = await context.cookies();
    const dir = path.dirname(COOKIES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
    console.log(`Saved ${cookies.length} cookies to ${COOKIES_PATH}`);

    await browser.close();
  }

  private async getContext(): Promise<{ browser: Browser; context: BrowserContext }> {
    if (!fs.existsSync(COOKIES_PATH)) {
      throw new Error(
        "No Facebook cookies found. Run the login flow first: POST /api/scrape/facebook/login"
      );
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });

    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8"));
    await context.addCookies(cookies);

    return { browser, context };
  }

  async scrape(options: ScraperOptions): Promise<ScrapedListing[]> {
    const { browser, context } = await this.getContext();

    try {
      const page = await context.newPage();
      const searchUrl = buildSearchUrl(options);
      console.log(`Scraping Facebook Marketplace: ${searchUrl}`);

      await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
      await randomDelay(2000, 4000);

      // Scroll to load more results
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 800);
        await randomDelay(1000, 2000);
      }

      const listings: ScrapedListing[] = [];

      // Facebook Marketplace listing cards — selectors may need updating
      const cards = await page.$$('[aria-label="Collection of Marketplace items"] > div');

      for (const card of cards) {
        try {
          const linkEl = await card.$("a[href*='/marketplace/item/']");
          if (!linkEl) continue;

          const href = await linkEl.getAttribute("href");
          if (!href) continue;

          const externalId = href.match(/\/item\/(\d+)/)?.[1] || "";
          const listingUrl = `https://www.facebook.com${href.split("?")[0]}`;

          // Extract text content from the card
          const texts = await card.$$eval("span", (spans) =>
            spans.map((s) => s.textContent?.trim() || "")
          );

          // Typically: price is first, title second, location third
          const priceText = texts.find((t) => /^\$[\d,]+/.test(t)) || "";
          const price = parseFloat(priceText.replace(/[$,]/g, "")) || 0;

          const title = texts.find((t) => t.length > 3 && !/^\$/.test(t)) || "";
          const location = texts.find(
            (t) => t.length > 2 && t !== title && !/^\$/.test(t) && !/^\d/.test(t)
          ) || "";

          // Try to get image
          const imgEl = await card.$("img");
          const imageUrl = imgEl ? (await imgEl.getAttribute("src")) || "" : "";

          if (externalId && title) {
            listings.push({
              externalId,
              title,
              description: "",
              price,
              imageUrl,
              listingUrl,
              location,
              postedAt: null,
            });
          }
        } catch {
          // Skip cards that fail to parse
        }
      }

      console.log(`Found ${listings.length} listings on Facebook Marketplace`);
      return listings;
    } finally {
      await browser.close();
    }
  }
}

function buildSearchUrl(options: ScraperOptions): string {
  const params = new URLSearchParams();
  params.set("query", options.query);
  if (options.maxPrice) {
    params.set("maxPrice", String(Math.round(options.maxPrice * 100))); // FB uses cents
  }
  params.set("daysSinceListed", "1"); // Recent listings only
  params.set("sortBy", "creation_time_descend");

  // Default to a broad area; location is set via cookies/account
  return `https://www.facebook.com/marketplace/search/?${params.toString()}`;
}

export const facebookScraper = new FacebookMarketplaceScraper();
