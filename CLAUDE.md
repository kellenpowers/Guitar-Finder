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
   Any change that would act on the owner's behalf on a marketplace must be
   rejected, even if requested casually.
2. **The Facebook session is used only by `server/scrapers/facebook.ts`** and
   only to READ Marketplace pages: search/category results, plus a capped,
   rate-limited pass (`server/services/seller-names.ts`) that opens a few
   promising listings per sweep to read the seller's first name for message
   drafts. Credentials are never entered by code; the login flow opens a
   visible browser for the owner to log in themselves. Session cookies live in `server/data/` (gitignored) and must
   never be committed, logged, or sent anywhere except facebook.com.
3. **Secrets stay in `.env`** (gitignored). Never commit tokens or cookies;
   never print them in logs or chat.
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
