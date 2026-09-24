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
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 1200);
        await randomDelay(1000, 2000);
      }

      // Find every listing link on the page instead of relying on Facebook's
      // container structure, which changes often and silently breaks parsing.
      const anchors = await page.$$("a[href*='/marketplace/item/']");
      if (anchors.length === 0) {
        console.warn(
          "No Marketplace item links found — Facebook may have changed its layout, " +
            "or the saved session is logged out (try logging in again)."
        );
      }

      const byId = new Map<string, ScrapedListing>();

      for (const anchor of anchors) {
        try {
          const href = await anchor.getAttribute("href");
          if (!href) continue;

          const externalId = href.match(/\/item\/(\d+)/)?.[1] || "";
          if (!externalId || byId.has(externalId)) continue;

          const listingUrl = `https://www.facebook.com/marketplace/item/${externalId}`;

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
            listingUrl,
            location: parsed.location,
            postedAt: null,
          });
        } catch {
          // Skip cards that fail to parse
        }
      }

      const listings = [...byId.values()];
      console.log(`Found ${listings.length} listings on Facebook Marketplace`);
      return listings;
    } finally {
      await browser.close();
    }
  }
}

// Facebook card text renders as lines like ["$500", "Canon AE-1 camera", "Austin, TX"].
// Exported for testing without a live Facebook page.
export function parseCardLines(
  lines: string[]
): { price: number; title: string; location: string } | null {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);

  const priceLine = cleaned.find((l) => /^\$[\d,]+/.test(l));
  const price = priceLine ? parseFloat(priceLine.replace(/[$,]/g, "")) || 0 : 0;

  const rest = cleaned.filter((l) => !/^\$[\d,]+/.test(l));
  const title = rest.find((l) => l.length > 3) || "";
  if (!title) return null;

  const afterTitle = rest.slice(rest.indexOf(title) + 1);
  const location = afterTitle.find((l) => l.length > 2) || "";

  return { price, title, location };
}

function buildSearchUrl(options: ScraperOptions): string {
  const params = new URLSearchParams();
  params.set("query", options.query);
  if (options.maxPrice) {
    params.set("maxPrice", String(Math.round(options.maxPrice))); // dollars
  }
  params.set("daysSinceListed", "7");
  params.set("sortBy", "creation_time_descend");

  // Default to a broad area; location is set via cookies/account
  return `https://www.facebook.com/marketplace/search/?${params.toString()}`;
}

export function saveCookies(cookies: unknown[]) {
  const dir = path.dirname(COOKIES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  console.log(`Saved ${cookies.length} cookies to ${COOKIES_PATH}`);
}

export const facebookScraper = new FacebookMarketplaceScraper();
