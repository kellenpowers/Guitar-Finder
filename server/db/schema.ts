import type Database from "better-sqlite3";

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      max_price REAL,
      min_deal_score INTEGER NOT NULL DEFAULT 0,
      location TEXT NOT NULL DEFAULT '',
      radius_miles INTEGER NOT NULL DEFAULT 25,
      is_active INTEGER NOT NULL DEFAULT 1,
      cron_schedule TEXT NOT NULL DEFAULT '*/30 * * * *',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_id INTEGER NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK(source IN ('facebook', 'craigslist')),
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      listing_url TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      posted_at TEXT,
      scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, external_id)
    );

    CREATE TABLE IF NOT EXISTS market_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      estimated_market_value REAL NOT NULL,
      reverb_listings TEXT NOT NULL DEFAULT '[]',
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_listings_search_id ON listings(search_id);
    CREATE INDEX IF NOT EXISTS idx_listings_source_external ON listings(source, external_id);
    CREATE INDEX IF NOT EXISTS idx_market_prices_listing_id ON market_prices(listing_id);
  `);
}
