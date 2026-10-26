# Guitar Deal Finder — project rules

A personal reselling-arbitrage app that runs on the owner's computer. Its job
is finding items on local marketplaces that can be profitably resold
nationally. An hourly **discovery** sweep (`server/services/discovery.ts`)
browses high-resale categories newest-first on Facebook Marketplace and
Craigslist — no keywords — plus optional saved keyword searches across all
five sources (FB, Craigslist, eBay, OfferUp, Reverb). Every find is valued
against real sold prices (eBay sold median → Reverb price guide → Reverb
asking as labeled last resort, cached per query in `valuation_cache`), and
the dashboard ranks by Flip Score (`server/services/flip-score.ts`) built on
estimated profit after resale fees, shipping, and the pickup drive
(`server/services/profit.ts`).

## Hard rules

1. **Scrapers are strictly read-only.** They may navigate, scroll, and read
   pages — never click, type, fill forms, send messages, post, bid, or buy.
   Any change that would make a SCRAPER act on the owner's behalf must be
   rejected, even if requested casually. Separately, by the owner's explicit
   decision (Oct 2026): the app MAY create, end, and reprice the owner's own
   resale listings through OFFICIAL seller APIs (Reverb API, eBay Sell APIs)
   — each listing action initiated by an explicit owner tap on a specific
   item, never autonomously, with two standing exceptions the owner
   pre-authorized: (a) after a confirmed sale on one platform, ending the
   duplicate listing on the other platform; (b) the repricing autopilot
   (owner's decision, Oct 26 2026: "as long as we're making the profit
   margin we agreed on, you can handle all of that stuff") — a daily,
   engagement-driven markdown pass (`server/services/repricer.ts`) whose
   policy and margin floors live in `server/services/pricing.ts`: never
   below the margin-doctrine floor until an item has sat unsold past the
   last-resort window, then never below fee-adjusted breakeven on what the
   owner paid; selling at an actual loss is always the owner's tap, never
   automatic. Items without a cost basis stop at a conservative estimated
   floor. The owner can switch any item's autopilot off in the app. Owner-
   tapped price changes are not floor-bound (his item, his price). Buyer-side
   actions (messaging, bidding, buying) remain forbidden everywhere.
2. **The Facebook session is used only by `server/scrapers/facebook.ts`** and
   only to READ Marketplace pages: search/category results, plus a capped,
   rate-limited pass (`server/services/seller-names.ts`) that opens a few
   promising listings per sweep to read the seller's first name for message
   drafts. Credentials are never entered by code; the login flow opens a
   visible browser for the owner to log in themselves. Session cookies live in `server/data/` (gitignored) and must
   never be committed, logged, or sent anywhere except facebook.com.
3. **Secrets stay in `.env`** (gitignored). Never commit tokens or cookies;
   never print them in logs or chat. One exception by necessity: the eBay
   user refresh token obtained via OAuth consent is stored in the local
   gitignored SQLite settings table (`ebay_refresh_token`).
4. **Be a polite scraper.** Keep the randomized delays and rate limits.
   Don't raise scrape frequency defaults or remove delays without the owner
   asking; aggressive scraping risks their accounts and IP.

## Conventions

- The owner is non-technical and edits nothing by hand: tunables (deal
  threshold, recency windows, scroll counts, rate limits, result caps) are
  plain constants in code, changed through Claude. Keep them near the top of
  their file with a comment saying what they control.
- HTML/text parsers are pure, exported functions (`parseCardLines`,
  `parseEbayHtml`, `parseCraigslistHtml`) so they're testable without live
  sites. Keep them that way and update `server/test/` when they change.
- One scraper failing must never stop the others (per-scraper try/catch in
  `server/services/scheduler.ts`).
- The server runs via `tsx` (no type-checking at runtime). Run
  `npm run typecheck` and `npm test` before committing server changes.
- The client is served statically by the server at localhost:3001; rebuild
  with `npm run build --workspace=client` after client changes.
- Marketplaces change their markup regularly. When a source returns 0
  results, suspect layout change or bot-check first; scrapers should log
  enough to tell which (page title, warning messages).

## Layout

- `server/index.ts` — Express app, API routes, serves `client/dist`, starts scheduler
- `server/scrapers/` — one file per source + shared `browser.ts` (headless, no login)
- `server/services/` — scheduler (cron per saved search), valuation, deal scoring
- `server/db/` — SQLite schema + one-time migrations in `schema.ts`
- `client/src/` — React SPA: Dashboard, Listings, Searches pages
