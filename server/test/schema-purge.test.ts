import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "../db/schema.js";

// The one-time purge that removes rows mis-parsed as "Just listed" (a
// Facebook badge, not a title) plus pre-filter junk under the price floor.
describe("badge-title purge migration", () => {
  it("removes mis-parsed and junk rows once, keeps real listings", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initSchema(db);

    // Simulate an existing DB from before the fix: flag absent, junk present
    db.prepare("DELETE FROM settings WHERE key = 'badge_rows_purged'").run();
    db.prepare("INSERT INTO saved_searches (name, query) VALUES ('t','')").run();
    const ins = db.prepare(
      "INSERT INTO listings (search_id, source, external_id, title, price, listing_url) VALUES (1,?,?,?,?,?)"
    );
    ins.run("facebook", "1", "Just listed", 1, "u1");
    ins.run("facebook", "2", "Just listed", 4, "u2");
    ins.run("facebook", "3", "Beige RCA Cables", 4, "u3"); // under the floor
    ins.run("facebook", "4", "Gibson Les Paul Studio", 900, "u4");
    db.prepare(
      "INSERT INTO market_prices (listing_id, query, estimated_market_value) VALUES (1, 'Just listed', 99)"
    ).run();
    db.prepare(
      "INSERT INTO valuation_cache (query, estimated_value) VALUES ('Just listed', 99)"
    ).run();

    initSchema(db); // re-running the schema triggers the purge

    const titles = db.prepare("SELECT title FROM listings ORDER BY id").all() as Array<{ title: string }>;
    expect(titles.map((t) => t.title)).toEqual(["Gibson Les Paul Studio"]);
    expect((db.prepare("SELECT COUNT(*) n FROM market_prices").get() as any).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) n FROM valuation_cache").get() as any).n).toBe(0);

    // Flag set — a later restart must not delete anything again
    const flag = db.prepare("SELECT value FROM settings WHERE key = 'badge_rows_purged'").get();
    expect(flag).toBeTruthy();
    ins.run("facebook", "5", "Just listed", 1, "u5"); // can't happen post-fix, but prove idempotence
    initSchema(db);
    expect((db.prepare("SELECT COUNT(*) n FROM listings").get() as any).n).toBe(2);
    db.close();
  });
});
