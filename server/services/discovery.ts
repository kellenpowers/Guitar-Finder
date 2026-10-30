import { getDb } from "../db/index.js";
import { facebookScraper, citySlug } from "../scrapers/facebook.js";
import { scrapeCraigslistSection } from "../scrapers/craigslist.js";
import { estimateValue } from "./valuation.js";
import { applyDistances } from "./distance.js";
import { publishSnapshot } from "./publisher.js";
import { applySellerNames } from "./seller-names.js";
import { isServiceAd, repeatedAdTitles } from "./listing-filter.js";
import { normalizeQuery } from "./relevance.js";
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
const VALUATIONS_PER_RUN = 40; // cap NETWORK sold-price lookups per sweep (politeness)
const VALUATION_FETCH_LIMIT = 200; // rows considered per sweep — cache hits are free
export const DISCOVERY_CRON = "0 * * * *"; // hourly

// ===== Search radius (owner's request, Oct 2026: 250 miles) =====
// Facebook and Craigslist only show one metro at a time, so a 250-mile radius
// means sweeping the metros inside the circle. The home city is swept every
// hour as always; the remote metros below ROTATE a couple per sweep so the
// hourly Facebook load barely grows (polite-scraper rule — raise
// REMOTE_CITIES_PER_SWEEP only with the owner's say-so). A remote find being
// a few hours old doesn't matter: it's a long drive either way, and the Flip
// Score's drive-time penalty decides whether it's worth it.
export const REMOTE_CITIES: Array<{ location: string; cl: string }> = [
  { location: "Hilton Head, SC", cl: "hiltonhead" },
  { location: "Statesboro, GA", cl: "statesboro" },
  { location: "Brunswick, GA", cl: "brunswick" },
  { location: "Charleston, SC", cl: "charleston" },
  { location: "Augusta, GA", cl: "augusta" },
  { location: "Jacksonville, FL", cl: "jacksonville" },
  { location: "Columbia, SC", cl: "columbia" },
  { location: "Macon, GA", cl: "macon" },
  { location: "Atlanta, GA", cl: "atlanta" },
  { location: "Gainesville, FL", cl: "gainesville" },
  { location: "Myrtle Beach, SC", cl: "myrtlebeach" },
];
const REMOTE_CITIES_PER_SWEEP = 2; // full circle covered every ~6 hours

// Which remote metros this hour's sweep covers — stateless rotation off the
// clock, so restarts can't reset it. Pure, exported for tests.
export function remoteCitiesForSweep(nowMs: number): Array<{ location: string; cl: string }> {
  if (REMOTE_CITIES.length === 0) return [];
  const hour = Math.floor(nowMs / 3_600_000);
  const start = (hour * REMOTE_CITIES_PER_SWEEP) % REMOTE_CITIES.length;
  return Array.from(
    { length: Math.min(REMOTE_CITIES_PER_SWEEP, REMOTE_CITIES.length) },
    (_, i) => REMOTE_CITIES[(start + i) % REMOTE_CITIES.length]
  );
}

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
    l.price >= PRICE_MIN &&
    l.price <= PRICE_MAX &&
    l.title.trim().length >= MIN_TITLE_LEN &&
    !isServiceAd(l.title)
  );
}

// Phase 1 for any area: browse each category page newest-first and keep what's
// worth valuing. Shared by the hourly discovery sweep (home city) and by
// keyword-less "area scan" saved searches pointed at other towns.
export async function sweepCategoriesInto(
  searchId: number,
  city: string,
  clSite: string
): Promise<{ found: number; newCount: number }> {
  const db = getDb();
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

  return { found, newCount };
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

    const rotation = remoteCitiesForSweep(Date.now());
    console.log(
      `Discovery sweep starting (home: ${city || "account default"}; this hour's remote metros: ` +
        `${rotation.map((r) => r.location).join(", ") || "none"})...`
    );

    let { found, newCount } = await sweepCategoriesInto(searchId, city, clSite);

    // The 250-mile radius: remote metros, a couple per sweep. One metro
    // failing must never stop the others (same rule as per-scraper isolation).
    for (const rc of rotation) {
      try {
        const r = await sweepCategoriesInto(searchId, citySlug(rc.location), rc.cl);
        found += r.found;
        newCount += r.newCount;
      } catch (err) {
        console.error(`Remote metro sweep failed (${rc.location}):`, err instanceof Error ? err.message : err);
      }
    }

    // Spam ads blast the same title across every nearby city — drop every copy
    // (and its cached valuation) before anything gets valued
    purgeRepeatedAds(db);

    await applyDistances().catch((err) => console.error("Distance pass failed:", err));

    const { valued, networkLookups } = await valueUnvalued(searchId);

    await applySellerNames().catch((err) => console.error("Seller-name pass failed:", err));
    // Retire listings that already sold or vanished since we found them
    const { checkListingLiveness } = await import("./liveness.js");
    await checkListingLiveness().catch((err) => console.error("Liveness check failed:", err));
    await publishSnapshot();

    console.log(
      `Discovery sweep done: ${found} listings seen, ${newCount} new kept, ` +
        `${valued} valued (${networkLookups} real lookups, rest cached).`
    );
    return { found, newCount, valued };
  } finally {
    running = false;
  }
}

// The same distinctive title in several places = a service ad posted city by
// city (the locksmith key-fob pattern). Delete every copy and its poisoned
// valuation-cache entry so it can't come back valued.
export function purgeRepeatedAds(db: any): number {
  const rows = db.prepare("SELECT title, location FROM listings").all() as {
    title: string;
    location: string | null;
  }[];
  const spam = repeatedAdTitles(rows);
  if (spam.size === 0) return 0;
  const delListing = db.prepare("DELETE FROM listings WHERE lower(trim(title)) = ?");
  const delCache = db.prepare("DELETE FROM valuation_cache WHERE query = ?");
  let removed = 0;
  for (const t of spam) {
    removed += delListing.run(t).changes;
    delCache.run(normalizeQuery(t));
  }
  console.log(`Purged ${removed} copies of ${spam.size} repeated service ads (same title, many cities).`);
  return removed;
}

// Phase 2 for any search: value its freshest unvalued finds against sold
// prices, capped per run for politeness (cache hits are free).
export async function valueUnvalued(
  searchId: number
): Promise<{ valued: number; networkLookups: number }> {
  const db = getDb();
  const unvalued = db.prepare(`
    SELECT l.* FROM listings l
    LEFT JOIN market_prices mp ON mp.listing_id = l.id
    WHERE l.search_id = ? AND mp.id IS NULL
    ORDER BY l.scraped_at DESC
    LIMIT ?
  `).all(searchId, VALUATION_FETCH_LIMIT) as any[];

  let valued = 0;
  let networkLookups = 0;
  const priceStmt = db.prepare(`
    INSERT INTO market_prices (listing_id, query, estimated_market_value, reverb_listings, value_source, sales_per_week)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const listing of unvalued) {
    if (networkLookups >= VALUATIONS_PER_RUN) break;
    try {
      const { result, fromCache } = await estimateValue(listing.title);
      if (result) {
        priceStmt.run(
          listing.id, listing.title, result.estimatedValue,
          JSON.stringify(result.comparables), result.source, result.salesPerWeek ?? null
        );
        valued++;
      }
      if (!fromCache) {
        networkLookups++;
        await new Promise((r) => setTimeout(r, 1500)); // politeness between real lookups
      }
    } catch (err) {
      console.error(`Valuation failed for "${listing.title}":`, err);
    }
  }
  return { valued, networkLookups };
}
