import { chromium, type Browser } from "playwright";

// Shared headless browser for scrapers that don't need a login session.
// Sites like eBay and Craigslist block plain HTTP fetches but serve a real
// browser normally, and reusing one browser avoids a launch per request.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

// Load a URL in the shared browser and return the rendered HTML.
export async function fetchRenderedHtml(url: string, waitMs = 2500): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: USER_AGENT });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(waitMs);
    return await page.content();
  } finally {
    await context.close();
  }
}
