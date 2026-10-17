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

export async function uploadPhoto(file: File | Blob, extOverride?: string): Promise<string> {
  const name = file instanceof File ? file.name : "";
  const ext = (extOverride || name.split(".").pop() || "jpg").toLowerCase();
  const { signedUrl, path } = await call("POST", { action: "uploadUrl", ext });
  const put = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "image/jpeg" },
    body: file,
  });
  if (!put.ok) throw new Error(`photo upload failed (${put.status})`);
  return path;
}

// Small JPEG copy of a photo for eBay's image search (full photos stay full-res)
export async function downscaleImage(file: File, maxDim = 1024): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image load failed"));
      el.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    if (!blob) throw new Error("downscale failed");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface IdentifyResult {
  ok: boolean;
  title?: string;
  source?: string;
  candidates?: string[];
  description?: string;
  condition_notes?: string;
  questions?: string[];
  suggested_target?: number;
  error?: string;
}

// Create/update/delete a saved search from the phone — the Mac applies it
// through its own API, so scheduling starts immediately
export async function queueManageSearch(
  op: "create" | "update" | "delete",
  fields?: Record<string, unknown>,
  id?: number
): Promise<string> {
  const data = await call("POST", {
    action: "queue",
    kind: "manage_search",
    payload: { op, id: id ?? null, fields: fields || {} },
  });
  return data.command?.id || "";
}

// Ask the Mac to work out what the item in these photos is
export async function queueIdentifyItem(probePaths: string[], photoPaths: string[]): Promise<string> {
  const data = await call("POST", {
    action: "queue",
    kind: "identify_item",
    payload: {
      probe_urls: probePaths.map(photoUrl),
      photo_urls: photoPaths.map(photoUrl),
    },
  });
  return data.command?.id || "";
}

// Queue a listing command for the studio Mac (it holds the API tokens and
// checks for commands every minute). Returns the command id so the phone can
// poll for the outcome.
export async function queueListOnReverb(item: InventoryItem): Promise<string> {
  const data = await call("POST", {
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
  return data.command?.id || "";
}

// Poll a queued command until the Mac reports back. Returns null if nothing
// happened before the timeout (Mac off or asleep) — queued, not failed.
export async function waitForCommand(
  id: string,
  { timeoutMs = 180_000, intervalMs = 5_000 } = {}
): Promise<{ status: "done" | "error"; error?: string; result?: any } | null> {
  if (!id) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const data = await call("POST", { action: "commandStatus", id });
      const c = data.command;
      if (c?.status === "done") return { status: "done", result: c?.result };
      if (c?.status === "error") {
        return { status: "error", error: c?.result?.error || "unknown error", result: c?.result };
      }
    } catch {
      // transient network blip — keep polling until the deadline
    }
  }
  return null;
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

export async function queueListOnEbay(item: InventoryItem): Promise<string> {
  const data = await call("POST", {
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
  return data.command?.id || "";
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
