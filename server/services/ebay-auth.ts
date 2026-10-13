import { getDb } from "../db/index.js";

// eBay user-account OAuth (seller consent). The one-time consent produces a
// refresh token (~18 months) stored in the local gitignored SQLite settings
// table; short-lived access tokens are minted from it on demand.

const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
].join(" ");

function creds(): { id: string; secret: string; runame: string } | null {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  const runame = process.env.EBAY_RUNAME;
  if (!id || !secret || !runame) return null;
  return { id, secret, runame };
}

export function consentUrl(): string | null {
  const c = creds();
  if (!c) return null;
  const params = new URLSearchParams({
    client_id: c.id,
    redirect_uri: c.runame,
    response_type: "code",
    scope: SCOPES,
  });
  return `https://auth.ebay.com/oauth2/authorize?${params.toString()}`;
}

function setSetting(key: string, value: string) {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

function getSetting(key: string): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value || "";
}

// Accepts the raw authorization code or the whole URL the user landed on
export function extractCode(input: string): string {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/[?&]code=([^&\s]+)/)?.[1];
  return decodeURIComponent(fromUrl || trimmed);
}

export async function exchangeConsentCode(input: string): Promise<{ ok: boolean; error?: string }> {
  const c = creds();
  if (!c) return { ok: false, error: "EBAY_CLIENT_ID/SECRET/RUNAME not all set in .env" };

  const code = extractCode(input);
  const basic = Buffer.from(`${c.id}:${c.secret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: c.runame,
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.refresh_token) {
    const detail = data.error_description || data.error || `status ${res.status}`;
    return { ok: false, error: `eBay rejected the code: ${detail}` };
  }

  setSetting("ebay_refresh_token", data.refresh_token);
  setSetting(
    "ebay_refresh_expires_at",
    String(Date.now() + (data.refresh_token_expires_in ?? 47304000) * 1000)
  );
  // A reconnect may be a DIFFERENT eBay account — the old account's cached
  // access token must not survive it
  cachedUserToken = null;
  console.log("eBay account connected — seller actions are now available.");
  return { ok: true };
}

export function ebayConnection(): { connected: boolean; expiresAt: number | null } {
  const token = getSetting("ebay_refresh_token");
  const expires = Number(getSetting("ebay_refresh_expires_at")) || null;
  return { connected: !!token, expiresAt: expires };
}

let cachedUserToken: { value: string; expiresAt: number } | null = null;

// Access token for seller API calls, minted from the stored refresh token
export async function getEbayUserToken(): Promise<string> {
  const c = creds();
  const refresh = getSetting("ebay_refresh_token");
  if (!c || !refresh) throw new Error("eBay account not connected");

  if (cachedUserToken && Date.now() < cachedUserToken.expiresAt - 60_000) {
    return cachedUserToken.value;
  }
  const basic = Buffer.from(`${c.id}:${c.secret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      scope: SCOPES,
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`eBay token refresh failed: ${data.error_description || res.status}`);
  }
  cachedUserToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
  };
  return cachedUserToken.value;
}
