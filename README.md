# Deal Finder

Find underpriced items on Facebook Marketplace by comparing prices against Reverb market values.

## Setup

```bash
npm install
npx playwright install chromium
```

Set your Reverb API token:
```bash
export REVERB_API_TOKEN=your_token_here
```
Get a free token at https://reverb.com/my/api_settings

## Usage

```bash
npm run dev
```

This starts both the backend (port 3001) and frontend (port 5173).

### First run:
1. Go to http://localhost:5173/searches
2. Click "FB Login" to open a browser and log into Facebook
3. Create a saved search (e.g., "Fender Stratocaster", location "Austin, TX")
4. Click "Run Now" to scrape Facebook Marketplace
5. Check the Dashboard for deals scored against Reverb prices

## How it works

1. **Scrapes Facebook Marketplace** using Playwright with your logged-in session
2. **Checks Reverb** for comparable items to estimate market value
3. **Scores deals** based on how far below market the listing price is
4. **Dashboard** shows the best deals sorted by score
