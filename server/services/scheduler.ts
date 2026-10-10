import cron from "node-cron";
import { getDb } from "../db/index.js";
import { facebookScraper } from "../scrapers/facebook.js";
import { craigslistScraper } from "../scrapers/craigslist.js";
import { ebayScraper } from "../scrapers/ebay.js";
import { reverbScraper } from "../scrapers/reverb.js";
import { offerUpScraper } from "../scrapers/offerup.js";
import { estimateValue } from "./valuation.js";
import { runDiscovery, DISCOVERY_CRON } from "./discovery.js";
import { applyDistances } from "./distance.js";
import { publishSnapshot } from "./publisher.js";
import { applySellerNames } from "./seller-names.js";
import type { Scraper, ScraperOptions, ScrapedListing } from "../scrapers/base.js";

const scrapers: Scraper[] = [
  facebookScraper,
  craigslistScraper,
  ebayScraper,
  offerUpScraper,
  reverbScraper,
];

const activeTasks = new Map<number, cron.ScheduledTask>();

export function startScheduler(): void {
  const db = getDb();
  const searches = db.prepare("SELECT * FROM saved_searches WHERE is_active = 1").all() as any[];

  for (const search of searches) {
    scheduleSearch(search);
  }

  console.log(`Scheduler started with ${searches.length} active searches`);

  // Discovery: automatic category sweeps, hourly plus a kick shortly after boot
  cron.schedule(DISCOVERY_CRON, () => {
    runDiscovery().catch((err) => console.error("Scheduled discovery failed:", err));
  });
  setTimeout(() => {
    runDiscovery().catch((err) => console.error("Boot discovery failed:", err));
  }, 20_000);
  console.log("Discovery sweeps scheduled (hourly; first sweep starts in ~20s)");
}

export function scheduleSearch(search: any): void {
  // Stop existing task if any
  const existing = activeTasks.get(search.id);
  if (existing) existing.stop();

  if (!cron.validate(search.cron_schedule)) {
    console.error(`Invalid cron schedule for search ${search.id}: ${search.cron_schedule}`);
    return;
  }

  const task = cron.schedule(search.cron_schedule, () => {
    runSearch(search).catch((err) => console.error(`Scheduled search ${search.id} failed:`, err));
  });

  activeTasks.set(search.id, task);
  console.log(`Scheduled search "${search.name}" (${search.cron_schedule})`);
}

export function stopSearch(searchId: number): void {
  const task = activeTasks.get(searchId);
  if (task) {
    task.stop();
    activeTasks.delete(searchId);
  }
}

export async function runSearch(search: any): Promise<number> {
  const db = getDb();
  const options: ScraperOptions = {
    query: search.query,
    location: search.location,
    radiusMiles: search.radius_miles,
    maxPrice: search.max_price,
  };

  console.log(`Running search "${search.name}" for "${search.query}"...`);

  // Run every source; one source failing (e.g. Facebook not logged in)
  // should not stop the others.
  const bySource: Array<{ source: string; listings: ScrapedListing[] }> = [];
  let totalFound = 0;
  for (const scraper of scrapers) {
    try {
      const listings = await scraper.scrape(options);
      bySource.push({ source: scraper.name, listings });
      totalFound += listings.length;
    } catch (err) {
      console.error(`${scraper.name} scrape failed:`, err instanceof Error ? err.message : err);
    }
  }

  let newCount = 0;
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO listings (search_id, source, external_id, title, description, price, image_url, listing_url, location, posted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const { source, listings } of bySource) {
    for (const listing of listings) {
      const result = insertStmt.run(
        search.id, source, listing.externalId, listing.title, listing.description,
        listing.price, listing.imageUrl, listing.listingUrl, listing.location, listing.postedAt
      );
      if (result.changes > 0) {
        newCount++;
        // Auto-check price for new listings
        try {
          const { result: priceResult, fromCache } = await estimateValue(listing.title);
          if (priceResult) {
            const listingRow = db.prepare(
              "SELECT id FROM listings WHERE source = ? AND external_id = ?"
            ).get(source, listing.externalId) as any;
            if (listingRow) {
              db.prepare(`
                INSERT INTO market_prices (listing_id, query, estimated_market_value, reverb_listings, value_source, sales_per_week)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(listingRow.id, listing.title, priceResult.estimatedValue, JSON.stringify(priceResult.comparables), priceResult.source, priceResult.salesPerWeek ?? null);
            }
          }
          // Rate limit real lookups; cache hits are free
          if (!fromCache) await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          console.error(`Price check failed for "${listing.title}":`, err);
        }
      }
    }
  }

  await applyDistances().catch((err) => console.error("Distance pass failed:", err));
  await applySellerNames().catch((err) => console.error("Seller-name pass failed:", err));
  await publishSnapshot();

  console.log(`Search "${search.name}": found ${totalFound} listings, ${newCount} new`);
  return newCount;
}
