# Guitar Deal Finder

Find underpriced guitars on Facebook Marketplace, Craigslist, and eBay by comparing asking prices against Reverb market values.

This app runs **on your own computer**. That's deliberate: Facebook has no public API, so the app browses Marketplace with your logged-in session — and that works far more reliably from your home internet connection than from a cloud server, which Facebook tends to block.

## Setup (once)

You need [Node.js](https://nodejs.org) installed. Then, in a terminal:

```bash
git clone https://github.com/kellenpowers/Guitar-Finder.git
cd Guitar-Finder
npm run setup
```

Then copy `.env.example` to a file named `.env` in the project folder and fill it in:

- `REVERB_API_TOKEN` — free token from https://reverb.com/my/api_settings, used to estimate what a guitar is actually worth (this powers deal scoring)
- `CRAIGSLIST_SITE` — the first part of your local craigslist URL, e.g. `austin` for austin.craigslist.org (leave empty to skip Craigslist)

eBay needs no setup — it's searched automatically.

## Running it

```bash
npm start
```

Then open **http://localhost:3001** in your browser.

### First run

1. Go to the **Searches** page and click **"Log in with Facebook"** — a real browser window opens on your computer. Log in normally (password, 2FA, whatever you use). The window closes by itself and your session is saved.
2. Create a saved search (e.g. "Fender Stratocaster", max price $800).
3. Click **"Run Now"** to scrape Facebook Marketplace.
4. Check the **Dashboard** for deals scored against Reverb prices.

Scheduled searches run automatically while the app is running. Your Facebook session lasts weeks to months; when scrapes start failing, just click "Log in with Facebook" again.

## How it works

1. **Searches three sources**: Facebook Marketplace (a real browser with your logged-in session), Craigslist, and eBay (no login needed)
2. **Checks Reverb** for comparable items to estimate market value
3. **Scores deals** by how far below market the asking price is
4. **Dashboard** shows the best deals sorted by score

**A note on Facebook:** there is no official Marketplace API, and automated browsing is against Facebook's terms of service. This tool mimics a human (real browser, random delays, low volume) for personal use, but Facebook changes its site regularly — expect the scraper to need occasional fixes, and don't crank the schedule frequency up.

## Optional: cloud hosting

The repo also includes configs to host the frontend on Vercel (`vercel.json`) and the backend on Render (`render.yaml`). Be warned that Facebook is much more likely to block a cloud server's IP, and Render's free tier wipes the saved session on every restart (use the "Paste Cookies" button to restore it). Set `VITE_API_URL` on the Vercel build to the Render URL so the frontend can find the backend.
