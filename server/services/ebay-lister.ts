import { getEbayUserToken } from "./ebay-auth.js";
import { getEbayAppToken } from "../scrapers/ebay.js";
import { ebayPriceMatchingReverbNet } from "./fees.js";
import { removePriceTalk } from "./listing-text.js";

// Creates LIVE eBay fixed-price listings through the official Trading API,
// at the owner's explicit per-item tap (CLAUDE.md rule 1, Oct 2026 decision).

// ===== eBay listing tunables =====
const CONDITION_ID = 3000; // Used
const ITEM_LOCATION = "Savannah, GA";
const ITEM_POSTAL_CODE = "31401";
const DISPATCH_DAYS = 3; // handling time
const RETURN_WINDOW = "Days_30";
const FALLBACK_CATEGORY_ID = "619"; // Musical Instruments & Gear (if suggestion fails)
const TRADING_COMPAT_LEVEL = "1193";

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function ebayItemIdFromUrl(url?: string | null): string {
  return url?.match(/\/itm\/(\d+)/)?.[1] || "";
}

export function reverbIdFromUrl(url?: string | null): string {
  return url?.match(/\/item\/(\d+)/)?.[1] || url?.match(/\/listings\/(\d+)/)?.[1] || "";
}

// Items cross-listed from Reverb get the fee-matched price (same net after
// eBay's bigger cut); standalone items use the target price on a .99
export function ebayAskPrice(targetPrice: number, reverbLinked: boolean): number {
  if (reverbLinked) return ebayPriceMatchingReverbNet(targetPrice);
  return Math.ceil(targetPrice) - 0.01;
}

// eBay rejects listings missing required "item specifics" (Brand almost
// everywhere) — fill the required ones from the title so a tap can't fail on
// a missing field. Free-text aspects accept these; if a category ever demands
// a closed-list value we can't infer, the error now surfaces on the phone.
const MPN_FALLBACK = "Does Not Apply";
const ASPECT_FALLBACK = "See Description";

export function brandFromTitle(title: string): string {
  return title.trim().split(/\s+/)[0] || "Unbranded";
}

export function aspectValueFor(name: string, title: string): string {
  const key = name.trim().toLowerCase();
  if (key === "brand") return brandFromTitle(title);
  if (key === "mpn") return MPN_FALLBACK;
  if (key === "model") {
    return title.trim().split(/\s+/).slice(1).join(" ").slice(0, 65) || ASPECT_FALLBACK;
  }
  return ASPECT_FALLBACK;
}

async function requiredAspects(categoryId: string): Promise<string[]> {
  try {
    const token = await getEbayAppToken();
    const res = await fetch(
      `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`aspects ${res.status}`);
    const data = await res.json();
    const names: string[] = (data?.aspects || [])
      .filter((a: any) => a?.aspectConstraint?.aspectRequired)
      .map((a: any) => String(a?.localizedAspectName || ""))
      .filter(Boolean);
    if (!names.some((n) => n.toLowerCase() === "brand")) names.push("Brand");
    return names;
  } catch (err) {
    console.warn("eBay aspect lookup failed (defaulting to Brand):", err instanceof Error ? err.message : err);
    return ["Brand"];
  }
}

async function suggestCategoryId(title: string): Promise<string> {
  try {
    const token = await getEbayAppToken();
    const res = await fetch(
      `https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(title)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`taxonomy ${res.status}`);
    const data = await res.json();
    const id = data?.categorySuggestions?.[0]?.category?.categoryId;
    if (id) return String(id);
  } catch (err) {
    console.warn("eBay category suggestion failed:", err instanceof Error ? err.message : err);
  }
  return FALLBACK_CATEGORY_ID;
}

async function tradingCall(callName: string, innerXml: string): Promise<string> {
  const token = await getEbayUserToken();
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  ${innerXml}
</${callName}Request>`;

  const res = await fetch("https://api.ebay.com/ws/api.dll", {
    method: "POST",
    headers: {
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPAT_LEVEL,
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": token,
      "Content-Type": "text/xml",
    },
    body: xml,
  });
  return res.text();
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function tradingErrors(responseXml: string): string {
  const messages = [...responseXml.matchAll(/<LongMessage>([^<]*)<\/LongMessage>/g)]
    .map((m) => xmlUnescape(m[1]))
    .join(" | ");
  return messages || "unknown Trading API error";
}

export interface EbayListingRequest {
  title: string;
  targetPrice: number | null;
  description: string;
  photoUrls: string[];
  reverbLinked: boolean;
}

export async function createEbayListing(
  req: EbayListingRequest
): Promise<{ ok: boolean; url?: string; price?: number; error?: string }> {
  if (!req.targetPrice || req.targetPrice <= 0) {
    return { ok: false, error: "Set a target price on the item first." };
  }
  if (req.photoUrls.length === 0) {
    return { ok: false, error: "eBay requires at least one photo." };
  }

  const price = ebayAskPrice(req.targetPrice, req.reverbLinked);
  const categoryId = await suggestCategoryId(req.title);
  const itemSpecifics = (await requiredAspects(categoryId))
    .map(
      (n) =>
        `<NameValueList><Name>${xmlEscape(n)}</Name><Value>${xmlEscape(aspectValueFor(n, req.title))}</Value></NameValueList>`
    )
    .join("");
  // The eBay price is raised above the target to cover fees, so any price
  // written into the description text would contradict the listing — strip it
  const description = removePriceTalk(req.description) || req.title;
  const descriptionHtml = xmlEscape(description).replace(/\n/g, "<br/>");
  const pictures = req.photoUrls
    .slice(0, 12)
    .map((u) => `<PictureURL>${xmlEscape(u)}</PictureURL>`)
    .join("");

  const inner = `<Item>
    <Title>${xmlEscape(req.title.slice(0, 80))}</Title>
    <Description><![CDATA[${descriptionHtml}]]></Description>
    <PrimaryCategory><CategoryID>${categoryId}</CategoryID></PrimaryCategory>
    <StartPrice>${price.toFixed(2)}</StartPrice>
    <ConditionID>${CONDITION_ID}</ConditionID>
    <ItemSpecifics>${itemSpecifics}</ItemSpecifics>
    <Country>US</Country>
    <Currency>USD</Currency>
    <DispatchTimeMax>${DISPATCH_DAYS}</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <Location>${xmlEscape(ITEM_LOCATION)}</Location>
    <PostalCode>${ITEM_POSTAL_CODE}</PostalCode>
    <PictureDetails>${pictures}</PictureDetails>
    <Quantity>1</Quantity>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <ReturnsWithinOption>${RETURN_WINDOW}</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
    </ReturnPolicy>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>USPSPriority</ShippingService>
        <ShippingServiceCost>0.00</ShippingServiceCost>
        <FreeShipping>true</FreeShipping>
      </ShippingServiceOptions>
    </ShippingDetails>
    <Site>US</Site>
  </Item>`;

  const response = await tradingCall("AddFixedPriceItem", inner);
  const ack = response.match(/<Ack>([^<]*)<\/Ack>/)?.[1] || "";
  const itemId = response.match(/<ItemID>(\d+)<\/ItemID>/)?.[1];

  if ((ack === "Success" || ack === "Warning") && itemId) {
    console.log(`eBay listing created: ${req.title} at $${price.toFixed(2)} (item ${itemId}).`);
    return { ok: true, url: `https://www.ebay.com/itm/${itemId}`, price };
  }
  const error = tradingErrors(response);
  console.error(`eBay listing failed: ${error}`);
  return { ok: false, error: `eBay: ${error.slice(0, 300)}` };
}

// Which eBay USER account the stored consent belongs to — listings post there.
// (The developer account only owns the app keys; it is not where listings go.)
export async function ebayWhoAmI(): Promise<{ username: string; feedbackScore: number | null } | null> {
  try {
    const response = await tradingCall("GetUser", "");
    const username = response.match(/<UserID>([^<]*)<\/UserID>/)?.[1] || "";
    if (!username) return null;
    const fb = response.match(/<FeedbackScore>(\d+)<\/FeedbackScore>/)?.[1];
    return { username, feedbackScore: fb ? Number(fb) : null };
  } catch {
    return null;
  }
}

// For multi-unit listings (one eBay listing covering several identical items):
// set how many units remain available. Use endEbayListing when it hits zero.
export async function reviseEbayQuantity(
  itemId: string,
  quantity: number
): Promise<{ ok: boolean; error?: string }> {
  const qty = Math.max(1, Math.floor(quantity));
  const inner = `<Item><ItemID>${xmlEscape(itemId)}</ItemID><Quantity>${qty}</Quantity></Item>`;
  const response = await tradingCall("ReviseFixedPriceItem", inner);
  const ack = response.match(/<Ack>([^<]*)<\/Ack>/)?.[1] || "";
  if (ack === "Success" || ack === "Warning") {
    console.log(`eBay listing ${itemId} quantity set to ${qty} (a unit sold elsewhere).`);
    return { ok: true };
  }
  const error = tradingErrors(response);
  console.error(`FAILED to set eBay listing ${itemId} quantity to ${qty}: ${error} — ADJUST IT MANUALLY.`);
  return { ok: false, error };
}

// Change the asking price of a live listing (owner-tapped from the phone, or
// the repricing autopilot inside its margin bounds — CLAUDE.md rule 1).
export async function reviseEbayPrice(
  itemId: string,
  price: number
): Promise<{ ok: boolean; error?: string }> {
  if (!(price > 0)) return { ok: false, error: "price must be above 0" };
  const inner = `<Item><ItemID>${xmlEscape(itemId)}</ItemID><StartPrice>${price.toFixed(2)}</StartPrice></Item>`;
  const response = await tradingCall("ReviseFixedPriceItem", inner);
  const ack = response.match(/<Ack>([^<]*)<\/Ack>/)?.[1] || "";
  if (ack === "Success" || ack === "Warning") {
    console.log(`eBay listing ${itemId} price set to $${price.toFixed(2)}.`);
    return { ok: true };
  }
  const error = tradingErrors(response);
  console.error(`FAILED to change eBay listing ${itemId} price to $${price.toFixed(2)}: ${error}`);
  return { ok: false, error };
}

// Engagement signal for the repricer: how many people watch this listing.
// Null means "couldn't read it", never zero — zero is a real signal.
export async function getEbayWatchCount(itemId: string): Promise<number | null> {
  try {
    const inner = `<ItemID>${xmlEscape(itemId)}</ItemID>
  <IncludeWatchCount>true</IncludeWatchCount>
  <OutputSelector>Item.WatchCount</OutputSelector>
  <OutputSelector>Ack</OutputSelector>`;
    const response = await tradingCall("GetItem", inner);
    const ack = response.match(/<Ack>([^<]*)<\/Ack>/)?.[1] || "";
    if (ack !== "Success" && ack !== "Warning") return null;
    const m = response.match(/<WatchCount>(\d+)<\/WatchCount>/);
    return m ? Number(m[1]) : 0; // a listing nobody watches omits the tag
  } catch {
    return null;
  }
}

export async function endEbayListing(itemId: string): Promise<{ ok: boolean; error?: string }> {
  const inner = `<ItemID>${xmlEscape(itemId)}</ItemID>
  <EndingReason>NotAvailable</EndingReason>`;
  const response = await tradingCall("EndFixedPriceItem", inner);
  const ack = response.match(/<Ack>([^<]*)<\/Ack>/)?.[1] || "";
  if (ack === "Success" || ack === "Warning") {
    console.log(`eBay listing ${itemId} ended (sold elsewhere).`);
    return { ok: true };
  }
  const error = tradingErrors(response);
  console.error(`FAILED to end eBay listing ${itemId}: ${error} — END IT MANUALLY.`);
  return { ok: false, error };
}
