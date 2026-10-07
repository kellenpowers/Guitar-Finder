import { chromium, type Browser } from "playwright";

// Shared headless browser for scrapers that don't need a login session.
// Sites like eBay and Craigslist block plain HTTP fetches but serve a real
// browser normally, and reusing one browser avoids a launch per request.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    // channel "chromium" = full Chromium in new-headless mode, which looks far
    // more like a real browser than the default headless shell (eBay serves
    // its error page to the shell)
    browserPromise = chromium
      .launch({ headless: true, channel: "chromium" })
      .catch(() => chromium.launch({ headless: true }));
  }
  return browserPromise;
}

// Basic automation-detection masking: real-browser values for the fields
// bot checks probe first
const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || { runtime: {} };
`;

// Load a URL in the shared browser and return the rendered HTML. When
// waitForSelector is given, wait up to 12s for it (results rendered by
// JavaScript), then settle briefly before snapshotting.
export async function fetchRenderedHtml(
  url: string,
  waitMs = 2500,
  waitForSelector?: string
): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 900 },
    locale: "en-US",
    timezoneId: "America/New_York",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  try {
    await context.addInitScript(STEALTH_SCRIPT);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 12_000 }).catch(() => {});
    }
    await page.waitForTimeout(waitMs);
    return await page.content();
  } finally {
    await context.close();
  }
}

export function pageTitleOf(html: string): string {
  return html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || "?";
}
