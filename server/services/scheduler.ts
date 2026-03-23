import cron from "node-cron";
import { getDb } from "../db/index.js";
import { facebookScraper } from "../scrapers/facebook.js";
import { checkPrice } from "./reverb-checker.js";
import type { ScraperOptions } from "../scrapers/base.js";

const activeTasks = new Map<number, cron.ScheduledTask>();

export function startScheduler(): void {
  const db = getDb();
  const searches = db.prepare("SELECT * FROM saved_searches WHERE is_active = 1").all() as any[];

  for (const search of searches) {
    scheduleSearch(search);
  }

  console.log(`Scheduler started with ${searches.length} active searches`);
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
  const listings = await facebookScraper.scrape(options);

  let newCount = 0;
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO listings (search_id, source, external_id, title, description, price, image_url, listing_url, location, posted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const listing of listings) {
    const result = insertStmt.run(
      search.id, "facebook", listing.externalId, listing.title, listing.description,
      listing.price, listing.imageUrl, listing.listingUrl, listing.location, listing.postedAt
    );
    if (result.changes > 0) {
      newCount++;
      // Auto-check price for new listings
      try {
        const priceResult = await checkPrice(listing.title);
        if (priceResult) {
          const listingRow = db.prepare(
            "SELECT id FROM listings WHERE source = ? AND external_id = ?"
          ).get("facebook", listing.externalId) as any;
          if (listingRow) {
            db.prepare(`
              INSERT INTO market_prices (listing_id, query, estimated_market_value, reverb_listings)
              VALUES (?, ?, ?, ?)
            `).run(listingRow.id, listing.title, priceResult.estimatedValue, JSON.stringify(priceResult.comparables));
          }
        }
      } catch (err) {
        console.error(`Price check failed for "${listing.title}":`, err);
      }
      // Rate limit Reverb API calls
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`Search "${search.name}": found ${listings.length} listings, ${newCount} new`);
  return newCount;
}
