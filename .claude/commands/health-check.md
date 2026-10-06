---
description: Run every marketplace source against a test query and report which work
---

Run a health check of all five scraper sources and report the results.

1. Make sure dependencies are installed, then write a temporary script (in a
   scratch directory, not the repo) that imports each scraper from
   `server/scrapers/` (facebook, craigslist, ebay, offerup, reverb) and runs
   `scrape({ query: "stratocaster", location: "Savannah, GA", radiusMiles: 25, maxPrice: 1000 })`
   on each, with a per-scraper try/catch, printing the source name, listing
   count, an example title+price, and any error. Also test the valuation
   chain: `estimateValue("Fender Stratocaster")` from
   `server/services/valuation.ts`.
2. Load `.env` from the project root first (like `server/index.ts` does), so
   the Reverb token and Facebook cookies behave exactly as in the real app.
3. Run it with `npx tsx` from the `server/` directory.
4. Report a table: source → status (OK with count / 0 results / error), and
   for each failure say what the likely cause is (logged out, bot check,
   layout change, missing token) and what would fix it.
5. Run `npm test` and `npm run typecheck` and include their results.
6. Change nothing — this command only diagnoses. Clean up the temporary
   script when done.
