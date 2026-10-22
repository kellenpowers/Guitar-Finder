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
      let anchors = await loadAndCollect(page, buildSearchUrl(options));

      // A wrong city slug can land on an empty page — retry without location
      if (anchors.length === 0 && citySlug(options.location)) {
        console.warn("No results with location slug — retrying without location.");
        anchors = await loadAndCollect(page, buildSearchUrl({ ...options, location: "" }));
      }
      warnIfEmpty(anchors.length);

      const listings = await parseAnchors(anchors);
      console.log(`Found ${listings.length} listings on Facebook Marketplace`);
      return listings;
    } finally {
      await browser.close();
    }
  }

  // Read seller first names from listing detail pages, for message drafts.
  // One browser, polite delays; callers cap how many URLs per sweep.
  async sellerNames(urls: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (urls.length === 0) return names;

    const { browser, context } = await this.getContext();
    try {
      const page = await context.newPage();
      for (const url of urls) {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await randomDelay(2000, 3500);
          const anchors = await page.$$("a[href*='/marketplace/profile/']");
          for (const a of anchors) {
            const text = ((await a.innerText().catch(() => "")) || "").trim();
            if (text && text.length > 1 && text.length < 60 && !/seller|details/i.test(text)) {
              names.set(url, text);
              break;
            }
          }
        } catch {
          // One failed page must not stop the rest
        }
      }
      return names;
    } finally {
      await browser.close();
    }
  }

  // Read the visible text of listing detail pages (for liveness checks).
  // One browser, polite delays; callers cap how many URLs per sweep.
  async pageTexts(urls: string[]): Promise<Map<string, string>> {
    const texts = new Map<string, string>();
    if (urls.length === 0) return texts;
    const { browser, context } = await this.getContext();
    try {
      const page = await context.newPage();
      for (const url of urls) {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
          await randomDelay(2000, 3500);
          const text = await page.innerText("body").catch(() => "");
          if (text) texts.set(url, text.slice(0, 20_000));
        } catch {
          // One failed page must not stop the rest
        }
      }
      return texts;
    } finally {
      await browser.close();
    }
  }

  // Scrape an arbitrary Marketplace URL (e.g. a category browse page) — used
  // by discovery sweeps. Same logged-in session, scrolling, and parsing.
  async scrapeUrl(url: string): Promise<ScrapedListing[]> {
    const { browser, context } = await this.getContext();
    try {
      const page = await context.newPage();
      const anchors = await loadAndCollect(page, url);
      warnIfEmpty(anchors.length);
      const listings = await parseAnchors(anchors);
      console.log(`Found ${listings.length} listings on Facebook Marketplace`);
      return listings;
    } finally {
      await browser.close();
    }
  }
}

async function loadAndCollect(page: import("playwright").Page, url: string) {
  console.log(`Scraping Facebook Marketplace: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await randomDelay(2000, 4000);
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 1200);
    await randomDelay(1000, 2000);
  }
  // Find every listing link on the page instead of relying on Facebook's
  // container structure, which changes often and silently breaks parsing.
  return page.$$("a[href*='/marketplace/item/']");
}

function warnIfEmpty(count: number) {
  if (count === 0) {
    console.warn(
      "No Marketplace item links found — Facebook may have changed its layout, " +
        "or the saved session is logged out (try logging in again)."
    );
  }
}

async function parseAnchors(
  anchors: Array<import("playwright").ElementHandle<SVGElement | HTMLElement>>
): Promise<ScrapedListing[]> {
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

      const imageUrl = await cardImageUrl(anchor);

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

  return [...byId.values()];
}

// Facebook decorates cards with badge lines ("Just listed", "Free", "Price
// drop") that are NOT the title — if we don't skip them, every result is
// titled "Just listed" and valuations run against that garbage query.
const BADGE_RE =
  /^(just (re)?listed|price drop(ped)?|reduced|sponsored|popular|in high demand|free|new|only \d+ left)$/i;

// Facebook card text renders as lines like ["Just listed", "$500",
// "Canon AE-1 camera", "Austin, TX"]. Exported for testing without a live page.
export function parseCardLines(
  lines: string[]
): { price: number; title: string; location: string } | null {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);

  // Marketplaces badge already-gone items right on the card — skip those
  if (cleaned.some((l) => /^(sold|pending|sale pending|out of stock)$/i.test(l))) {
    return null;
  }

  const usable = cleaned.filter((l) => !BADGE_RE.test(l));

  // Price-drop cards merge old and new price into one line ("$900$1,200") —
  // take only the leading number (the current price).
  const priceLine = usable.find((l) => /^\$[\d,]+/.test(l));
  const priceText = priceLine?.match(/^\$([\d,]+(?:\.\d+)?)/)?.[1] || "";
  const price = priceText ? parseFloat(priceText.replace(/,/g, "")) || 0 : 0;

  const rest = usable.filter((l) => !/^\$[\d,]+/.test(l));
  const title = rest.find((l) => l.length > 3) || "";
  if (!title) return null;

  const afterTitle = rest.slice(rest.indexOf(title) + 1);
  const location = afterTitle.find((l) => l.length > 2) || "";

  return { price, title, location };
}

// Pull the card photo out of an item anchor. Facebook lazy-loads images and
// sometimes paints them as CSS backgrounds instead of <img> tags, so check
// both — and never store data: placeholders as if they were photo URLs.
export async function cardImageUrl(
  anchor: import("playwright").ElementHandle<SVGElement | HTMLElement>
): Promise<string> {
  try {
    return await anchor.evaluate((el) => {
      const src = el.querySelector("img")?.getAttribute("src") || "";
      if (/^https?:\/\//.test(src)) return src;
      for (const node of Array.from(el.querySelectorAll("*"))) {
        const bg = getComputedStyle(node).backgroundImage || "";
        const m = bg.match(/url\("?(https?:[^")]+)"?\)/);
        if (m) return m[1];
      }
      return "";
    });
  } catch {
    return "";
  }
}

// "Savannah, GA" -> "savannah"; "San Diego, CA" -> "sandiego"
export function citySlug(location: string): string {
  const city = (location || "").split(",")[0].trim().toLowerCase();
  return city.replace(/[^a-z]/g, "");
}

function buildSearchUrl(options: ScraperOptions): string {
  const params = new URLSearchParams();
  params.set("query", options.query);
  if (options.maxPrice) {
    params.set("maxPrice", String(Math.round(options.maxPrice))); // dollars
  }
  params.set("daysSinceListed", "7");
  params.set("sortBy", "creation_time_descend");

  // With a location, use the city-specific marketplace page; otherwise
  // Facebook uses the account's home area.
  const slug = citySlug(options.location);
  const base = slug
    ? `https://www.facebook.com/marketplace/${slug}/search`
    : "https://www.facebook.com/marketplace/search";
  return `${base}/?${params.toString()}`;
}

export function saveCookies(cookies: unknown[]) {
  const dir = path.dirname(COOKIES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  console.log(`Saved ${cookies.length} cookies to ${COOKIES_PATH}`);
}

export const facebookScraper = new FacebookMarketplaceScraper();
