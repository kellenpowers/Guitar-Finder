import { describe, it, expect } from "vitest";
import { parseCardLines, citySlug } from "../scrapers/facebook.js";
import { parseEbayHtml, computeSalesPerWeek } from "../scrapers/ebay.js";
import { parseCraigslistHtml } from "../scrapers/craigslist.js";
import { scoreDeal } from "../services/deal-scorer.js";
import { estimateProfit, RESALE_FEE_PCT, SHIPPING_EST } from "../services/profit.js";
import { filterRelevant, significantTokens } from "../services/relevance.js";
import { computeFlipScore } from "../services/flip-score.js";

describe("parseCardLines (Facebook/OfferUp card text)", () => {
  it("parses price, title, and location", () => {
    expect(parseCardLines(["$500", "Canon AE-1 camera", "Savannah, GA"])).toEqual({
      price: 500,
      title: "Canon AE-1 camera",
      location: "Savannah, GA",
    });
  });

  it("handles commas in prices", () => {
    expect(parseCardLines(["$1,200", "Fender Stratocaster"])?.price).toBe(1200);
  });

  it("handles a missing location", () => {
    const parsed = parseCardLines(["$300", "Shure SM7B"]);
    expect(parsed?.location).toBe("");
  });

  it("returns null when there is no usable title", () => {
    expect(parseCardLines(["$50"])).toBeNull();
    expect(parseCardLines([])).toBeNull();
  });

  it("ignores blank lines", () => {
    expect(parseCardLines(["", "$75", "", "Boss pedal", " "])?.title).toBe("Boss pedal");
  });

  it("skips cards badged Sold or Pending", () => {
    expect(parseCardLines(["Sold", "$500", "Canon AE-1 camera", "Savannah, GA"])).toBeNull();
    expect(parseCardLines(["$500", "Canon AE-1 camera", "PENDING"])).toBeNull();
    expect(parseCardLines(["$500", "Sold out sign vintage", "Savannah, GA"])).not.toBeNull();
  });
});

describe("parseEbayHtml", () => {
  const card = (id: string, title: string, price: string) => `
    <li class="s-item">
      <a class="s-item__link" href="https://www.ebay.com/itm/${id}?hash=x"></a>
      <div class="s-item__title">${title}</div>
      <span class="s-item__price">${price}</span>
      <div class="s-item__image"><img src="https://i.ebayimg.com/${id}.jpg"/></div>
    </li>`;

  it("parses listings and skips the 'Shop on eBay' placeholder", () => {
    const html = `<ul>${card("111", "Shop on eBay", "$20.00")}${card("222", "Martin D-18", "$1,899.00")}</ul>`;
    const listings = parseEbayHtml(html);
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      externalId: "222",
      title: "Martin D-18",
      price: 1899,
      listingUrl: "https://www.ebay.com/itm/222",
    });
  });

  it("takes the first number of a price range", () => {
    const html = card("333", "Sony ZV-E10", "$550.00 to $650.00");
    expect(parseEbayHtml(html)[0].price).toBe(550);
  });

  it("skips cards without an item id", () => {
    const html = `<li class="s-item"><a class="s-item__link" href="https://www.ebay.com/other"></a><div class="s-item__title">No id</div></li>`;
    expect(parseEbayHtml(html)).toHaveLength(0);
  });

  it("extracts the sold date from sold-listing captions", () => {
    const html = `
      <li class="s-item">
        <a class="s-item__link" href="https://www.ebay.com/itm/444"></a>
        <div class="s-item__title">Canon AE-1</div>
        <span class="s-item__price">$150.00</span>
        <div class="s-item__caption"><span>Sold  Oct 5, 2026</span></div>
      </li>`;
    const [item] = parseEbayHtml(html);
    expect(item.postedAt).toContain("2026-10-05");
  });
});

describe("computeSalesPerWeek", () => {
  const day = 86_400_000;
  it("computes rate from sale timestamps", () => {
    // 5 sales over 7 days = 5/week
    const now = Date.now();
    const ts = [now, now - 2 * day, now - 3 * day, now - 5 * day, now - 7 * day];
    expect(computeSalesPerWeek(ts)).toBe(5);
  });
  it("flags slow movers", () => {
    const now = Date.now();
    // 3 sales over 90 days ≈ 0.2/week
    const rate = computeSalesPerWeek([now, now - 45 * day, now - 90 * day]);
    expect(rate).toBeLessThan(0.5);
  });
  it("needs at least 3 dated sales", () => {
    expect(computeSalesPerWeek([Date.now(), Date.now() - day])).toBeNull();
    expect(computeSalesPerWeek([Date.now(), NaN, NaN])).toBeNull();
  });
});

describe("parseCraigslistHtml", () => {
  it("parses the static (no-JS) markup", () => {
    const html = `
      <li class="cl-static-search-result" title="Canon camera">
        <a href="https://savannah.craigslist.org/pho/d/x/7712345678.html">
          <div class="title">Canon camera</div>
          <div class="price">$75</div>
          <div class="location">savannah</div>
        </a>
      </li>`;
    expect(parseCraigslistHtml(html)[0]).toMatchObject({
      externalId: "7712345678",
      title: "Canon camera",
      price: 75,
      location: "savannah",
    });
  });

  it("parses the rendered app markup", () => {
    const html = `
      <li class="cl-search-result" title="Martin D18 guitar">
        <a class="cl-app-anchor posting-title" href="https://savannah.craigslist.org/msg/d/y/7798765432.html">
          <span class="label">Martin D18 guitar</span>
        </a>
        <span class="priceinfo">$2,400</span>
      </li>`;
    expect(parseCraigslistHtml(html)[0]).toMatchObject({
      externalId: "7798765432",
      title: "Martin D18 guitar",
      price: 2400,
    });
  });

  it("dedupes listings that appear in both markups", () => {
    const html = `
      <li class="cl-static-search-result" title="Amp"><a href="https://x.craigslist.org/d/1.html"><div class="title">Amp</div></a></li>
      <li class="cl-search-result" title="Amp"><a href="https://x.craigslist.org/d/1.html"><span class="label">Amp</span></a></li>`;
    expect(parseCraigslistHtml(html)).toHaveLength(1);
  });
});

describe("scoreDeal", () => {
  it("scores a below-market listing", () => {
    expect(scoreDeal(500, 800)).toEqual({ dealScore: 38, savings: 300, savingsPercent: 37.5 });
  });

  it("clamps overpriced listings to 0", () => {
    expect(scoreDeal(900, 800)?.dealScore).toBe(0);
  });

  it("returns null without a market value", () => {
    expect(scoreDeal(500, 0)).toBeNull();
  });
});

describe("estimateProfit", () => {
  it("subtracts resale fees and shipping from the sale", () => {
    expect(estimateProfit(800, 500)).toBe(
      Math.round(800 * (1 - RESALE_FEE_PCT) - SHIPPING_EST - 500)
    );
  });
  it("goes negative when the flip loses money", () => {
    expect(estimateProfit(100, 200)).toBeLessThan(0);
  });
});

describe("filterRelevant (comp relevance)", () => {
  const comps = [
    { title: "DJI Osmo Action 4 Camera with accessories" },
    { title: "DJI Osmo Action 4 Standard Combo" },
    { title: "Fender Stratocaster neck plate chrome" },
    { title: "Guitar bridge saddle screws (6)" },
  ];

  it("keeps matching comps and drops unrelated ones", () => {
    const kept = filterRelevant("DJI Osmo Action 4", comps);
    expect(kept).toHaveLength(2);
    expect(kept.every((c) => c.title.includes("DJI"))).toBe(true);
  });

  it("drops guitar parts for a camera query", () => {
    expect(filterRelevant("Sony ZV-E10 mirrorless camera", comps)).toHaveLength(0);
  });

  it("ignores filler words when tokenizing", () => {
    expect(significantTokens("New Sony camera with great condition OBO")).toEqual(
      expect.arrayContaining(["sony", "camera"])
    );
    expect(significantTokens("new with for the obo")).toHaveLength(0);
  });

  it("matches despite filler in the query", () => {
    const kept = filterRelevant(
      "OBO like new DJI Osmo Action 4 great condition",
      comps
    );
    expect(kept).toHaveLength(2);
  });
});

describe("computeFlipScore", () => {
  it("maxes out a perfect flip", () => {
    expect(
      computeFlipScore({ estProfit: 300, price: 300, salesPerWeek: 3, valueSource: "ebay_sold" })
    ).toBe(100);
  });

  it("scores a middling flip in the middle", () => {
    // 0.5*0.5 + 0.2*0.5 + 0.2*0.5 + 0.1*0.4 = 0.49
    expect(
      computeFlipScore({ estProfit: 150, price: 300, salesPerWeek: null, valueSource: "reverb_asking" })
    ).toBe(49);
  });

  it("is 0 for unprofitable items and null without a value", () => {
    expect(
      computeFlipScore({ estProfit: -20, price: 100, salesPerWeek: 5, valueSource: "ebay_sold" })
    ).toBe(0);
    expect(
      computeFlipScore({ estProfit: null, price: 100, salesPerWeek: null, valueSource: null })
    ).toBeNull();
  });

  it("rewards high ROI on cheap items", () => {
    const cheap = computeFlipScore({ estProfit: 100, price: 50, salesPerWeek: 1, valueSource: "ebay_sold" })!;
    const pricey = computeFlipScore({ estProfit: 100, price: 1000, salesPerWeek: 1, valueSource: "ebay_sold" })!;
    expect(cheap).toBeGreaterThan(pricey);
  });
});

describe("citySlug", () => {
  it("lowercases and strips the state", () => {
    expect(citySlug("Savannah, GA")).toBe("savannah");
  });
  it("joins multi-word cities", () => {
    expect(citySlug("San Diego, CA")).toBe("sandiego");
  });
  it("returns empty for empty input", () => {
    expect(citySlug("")).toBe("");
  });
});
