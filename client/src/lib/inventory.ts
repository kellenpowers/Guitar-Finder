import { getPasscode } from "../api";

// Inventory lives in the cloud (same Supabase project as the snapshot), so
// the phone can add items and photos from anywhere. Gated by the passcode.
const SUPABASE_BASE = "https://xcwhcpithgcommwqpgif.supabase.co";
const FN_URL = `${SUPABASE_BASE}/functions/v1/inventory`;

export interface InventoryItem {
  id: string;
  title: string;
  status: "prepping" | "listed" | "sold";
  bought_price: number | null;
  target_price: number | null;
  source_url: string | null;
  photos: string[];
  listing_draft: string;
  reverb_url?: string | null;
  ebay_url?: string | null;
  video_url?: string | null;
  created_at: string;
}

async function call(method: "GET" | "POST", body?: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${FN_URL}?code=${encodeURIComponent(getPasscode())}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("bad-passcode");
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

function normalize(item: any): InventoryItem {
  return { ...item, photos: Array.isArray(item.photos) ? item.photos : [] };
}

export async function listInventory(): Promise<InventoryItem[]> {
  const data = await call("GET");
  return (data.items || []).map(normalize);
}

export async function createItem(fields: Partial<InventoryItem>): Promise<InventoryItem> {
  const data = await call("POST", { action: "create", ...fields });
  return normalize(data.item);
}

export async function updateItem(
  id: string,
  fields: Partial<InventoryItem>
): Promise<InventoryItem> {
  const data = await call("POST", { action: "update", id, ...fields });
  return normalize(data.item);
}

export async function deleteItem(id: string): Promise<void> {
  await call("POST", { action: "delete", id });
}

export async function uploadPhoto(file: File): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const { signedUrl, path } = await call("POST", { action: "uploadUrl", ext });
  const put = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "image/jpeg" },
    body: file,
  });
  if (!put.ok) throw new Error(`photo upload failed (${put.status})`);
  return path;
}

// Queue a listing command for the studio Mac (it holds the API tokens and
// checks for commands every minute)
export async function queueListOnReverb(item: InventoryItem): Promise<void> {
  await call("POST", {
    action: "queue",
    kind: "list_reverb",
    payload: {
      inventory_id: item.id,
      title: item.title,
      price: item.target_price,
      description: item.listing_draft,
      photo_urls: item.photos.map(photoUrl),
      video_url: item.video_url || null,
    },
  });
}

export function photoUrl(path: string): string {
  // Imported Reverb listings carry absolute photo URLs; our own uploads are
  // storage paths
  if (/^https?:\/\//.test(path)) return path;
  return `${SUPABASE_BASE}/storage/v1/object/public/photos/${path}`;
}

export async function queueImportReverb(): Promise<void> {
  await call("POST", { action: "queue", kind: "import_reverb", payload: {} });
}

export async function queueListOnEbay(item: InventoryItem): Promise<void> {
  await call("POST", {
    action: "queue",
    kind: "list_ebay",
    payload: {
      inventory_id: item.id,
      title: item.title,
      price: item.target_price,
      description: item.listing_draft,
      photo_urls: item.photos.map(photoUrl),
      reverb_linked: !!item.reverb_url,
    },
  });
}

// Applied at copy time so any "Asking $X" line matches the CURRENT target
// price — the copied text gets pasted places that don't show a price. (The
// Reverb/eBay listers strip price talk anyway; those platforms show the price.)
// The trailing guard skips ranges ("Asking $450-500") rather than garbling them.
const ASKING_RE_SRC =
  String.raw`(asking(?:\s+price)?(?:\s+is|:)?(?:\s+for)?\s*\$?\s*)[\d,]+(?:\.\d+)?(?![\d,]*\s*-\s*\d)`;

export function syncAskingPrice(draft: string, price: number | null): string {
  if (!price || price <= 0) return draft;
  if (new RegExp(ASKING_RE_SRC, "i").test(draft)) {
    return draft.replace(
      new RegExp(ASKING_RE_SRC, "gi"),
      (_m, lead) => `${lead}${Math.round(price)}`
    );
  }
  // The draft never had a price line (item was priced after creation) — add
  // one where generateListingDraft would have put it
  const lines = draft.split("\n");
  const askLine = `Asking $${Math.round(price)} shipped.`;
  const qIdx = lines.findIndex((l) => /^questions welcome\.?$/i.test(l.trim()));
  if (qIdx >= 0) lines.splice(qIdx, 0, askLine);
  else lines.push(askLine);
  return lines.join("\n");
}

// Resale listing draft in the owner's voice: no em dashes, no stock filler,
// honest and warm. The bracketed line is the one part he fills in.
export function generateListingDraft(title: string, targetPrice?: number | null): string {
  const clean = title.trim();
  const lines = [
    clean,
    "",
    `Up for sale is my ${clean}. It does what it should and it's ready for a new home. Ships fast and packed well.`,
    "[Describe condition and anything included.]",
  ];
  if (targetPrice && targetPrice > 0) {
    lines.push(`Asking $${Math.round(targetPrice)} shipped.`);
  }
  lines.push("Questions welcome.");
  return lines.join("\n");
}
