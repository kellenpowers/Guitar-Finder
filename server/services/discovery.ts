import { getDb } from "../db/index.js";
import { facebookScraper, citySlug } from "../scrapers/facebook.js";
import { scrapeCraigslistSection } from "../scrapers/craigslist.js";
import { estimateValue } from "./valuation.js";
import { applyDistances } from "./distance.js";
import type { ScrapedListing } from "../scrapers/base.js";

// ===== Discovery tunables =====
// Discovery sweeps high-resale categories newest-first (no keywords) on the
// local marketplaces, then values finds against sold prices.
const CATEGORIES: Array<{ name: string; fb: string | null; cl: string | null }> = [
  { name: "electronics", fb: "electronics", cl: "ela" },
  { name: "photo/video", fb: null, cl: "pha" },
  { name: "musical instruments", fb: "musical-instruments", cl: "msa" },
  { name: "tools", fb: "tools", cl: "tla" },
  { name: "video games", fb: "video-games", cl: "vga" },
  { name: "antiques", fb: "antiques", cl: "ata" },
];
const PRICE_MIN = 25; // ignore cheap junk — fees and shipping eat small flips
const PRICE_MAX = 5000;
const MIN_TITLE_LEN = 12; // vague titles can't be valued against comps
const VALUATIONS_PER_RUN = 40; // cap sold-price lookups per sweep (politeness)
export const DISCOVERY_CRON = "0 * * * *"; // hourly

const DISCOVERY_SEARCH_NAME = "Discovery (automatic)";

let running = false;

export function isDiscoveryRunning(): boolean {
  return running;
}

// The saved_searches row that discovery finds hang off (is_active=0 so the
// keyword scheduler never runs it as a search).
function ensureDiscoverySearch(db: any): number {
  const existing = db
    .prepare("SELECT id FROM saved_searches WHERE name = ?")
    .get(DISCOVERY_SEARCH_NAME);
  if (existing) return existing.id;
  const result = db
    .prepare(
      "INSERT INTO saved_searches (name, query, is_active, cron_schedule) VALUES (?, '', 0, '0 0 31 2 *')"
    )
    .run(DISCOVERY_SEARCH_NAME);
  return Number(result.lastInsertRowid);
}

function getSetting(db: any, key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row?.value || "";
}

function worthValuing(l: ScrapedListing): boolean {
  return (
    l.price >= PRICE_MIN && l.price <= PRICE_MAX && l.title.trim().length >= MIN_TITLE_LEN
  );
}

export async function runDiscovery(): Promise<{ found: number; newCount: number; valued: number }> {
  if (running) {
    console.log("Discovery already running — skipping this trigger.");
    return { found: 0, newCount: 0, valued: 0 };
  }
  running = true;
  try {
    const db = getDb();
    const searchId = ensureDiscoverySearch(db);
    const city = citySlug(getSetting(db, "default_location"));
    const clSite = process.env.CRAIGSLIST_SITE || city;

    console.log(`Discovery sweep starting (city: ${city || "account default"})...`);

    // Phase 1: sweep category pages newest-first
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO listings (search_id, source, external_id, title, description, price, image_url, listing_url, location, posted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let found = 0;
    let newCount = 0;

    for (const cat of CATEGORIES) {
      const batches: Array<{ source: string; listings: ScrapedListing[] }> = [];

      if (cat.fb) {
        try {
          const base = city
            ? `https://www.facebook.com/marketplace/${city}/${cat.fb}`
            : `https://www.facebook.com/marketplace/category/${cat.fb}`;
          const url = `${base}?sortBy=creation_time_descend&daysSinceListed=1`;
          batches.push({ source: "facebook", listings: await facebookScraper.scrapeUrl(url) });
        } catch (err) {
          console.error(`Discovery FB ${cat.name} failed:`, err instanceof Error ? err.message : err);
        }
      }

      if (cat.cl && clSite) {
        try {
          batches.push({
            source: "craigslist",
            listings: await scrapeCraigslistSection(clSite, cat.cl),
          });
        } catch (err) {
          console.error(`Discovery CL ${cat.name} failed:`, err instanceof Error ? err.message : err);
        }
      }

      for (const { source, listings } of batches) {
        for (const l of listings) {
          found++;
          if (!worthValuing(l)) continue;
          const result = insertStmt.run(
            searchId, source, l.externalId, l.title, l.description,
            l.price, l.imageUrl, l.listingUrl, l.location, l.postedAt
          );
          if (result.changes > 0) newCount++;
        }
      }
    }

    await applyDistances().catch((err) => console.error("Distance pass failed:", err));

    // Phase 2: value the freshest unvalued discovery finds against sold prices
    const unvalued = db.prepare(`
      SELECT l.* FROM listings l
      LEFT JOIN market_prices mp ON mp.listing_id = l.id
      WHERE l.search_id = ? AND mp.id IS NULL
      ORDER BY l.scraped_at DESC
      LIMIT ?
    `).all(searchId, VALUATIONS_PER_RUN) as any[];

    let valued = 0;
    const priceStmt = db.prepare(`
      INSERT INTO market_prices (listing_id, query, estimated_market_value, reverb_listings, value_source, sales_per_week)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const listing of unvalued) {
      try {
        const result = await estimateValue(listing.title);
        if (result) {
          priceStmt.run(
            listing.id, listing.title, result.estimatedValue,
            JSON.stringify(result.comparables), result.source, result.salesPerWeek ?? null
          );
          valued++;
        }
      } catch (err) {
        console.error(`Discovery valuation failed for "${listing.title}":`, err);
      }
      await new Promise((r) => setTimeout(r, 1500)); // politeness between lookups
    }

    console.log(
      `Discovery sweep done: ${found} listings seen, ${newCount} new kept, ${valued} valued (${unvalued.length - valued} had no comps).`
    );
    return { found, newCount, valued };
  } finally {
    running = false;
  }
}
