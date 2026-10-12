import { createReverbDraft } from "./reverb-lister.js";
import { importReverbListings } from "./reverb-importer.js";
import { createEbayListing } from "./ebay-lister.js";

// The phone queues listing commands in the cloud; the Mac (which holds all
// API tokens in .env) polls here, executes them, and reports back.

// ===== Command runner tunables =====
const POLL_INTERVAL_MS = 60_000; // check for new commands every minute

let polling = false;

function inventoryFnUrl(): string | null {
  const publishUrl = process.env.PUBLISH_URL;
  if (!publishUrl || !process.env.PUBLISH_KEY) return null;
  return publishUrl.replace(/\/publish\/?$/, "/inventory");
}

// Read the full cloud inventory as the Mac
export async function fetchCloudInventory(): Promise<any[]> {
  const url = inventoryFnUrl();
  if (!url) return [];
  const res = await fetch(url, {
    headers: { "x-publish-key": process.env.PUBLISH_KEY! },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `cloud ${res.status}`);
  return data.items || [];
}

export async function callCloud(body: Record<string, unknown>): Promise<any> {
  const url = inventoryFnUrl();
  if (!url) throw new Error("cloud not configured");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-publish-key": process.env.PUBLISH_KEY!,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `cloud ${res.status}`);
  return data;
}

// Cloud storage paths -> public URLs (imported Reverb photos are already absolute)
function photoUrlFromPath(p: string): string {
  if (/^https?:\/\//.test(p)) return p;
  const base = (process.env.PUBLISH_URL || "").replace(/\/functions\/.*$/, "");
  return base ? `${base}/storage/v1/object/public/photos/${p}` : p;
}

// The payload was snapshotted when the owner tapped the button, but the Mac
// may run it up to a minute (or a sleep) later. Re-read the item's CURRENT
// fields so a price or draft edited in between can't publish stale.
async function withFreshFields(payload: any): Promise<any> {
  if (!payload.inventory_id) return payload;
  try {
    const items = await fetchCloudInventory();
    const row = items.find((i: any) => i.id === payload.inventory_id);
    if (!row) return payload;
    return {
      ...payload,
      title: row.title ?? payload.title,
      price: row.target_price ?? null,
      description: row.listing_draft ?? payload.description,
      photo_urls:
        Array.isArray(row.photos) && row.photos.length > 0
          ? row.photos.map(photoUrlFromPath)
          : payload.photo_urls,
      video_url: row.video_url ?? payload.video_url ?? null,
      reverb_linked: row.reverb_url ? true : !!payload.reverb_linked,
    };
  } catch {
    return payload; // cloud hiccup — the tap-time snapshot is still internally consistent
  }
}

async function runCommand(command: any): Promise<void> {
  const payload = command.payload || {};

  if (command.kind === "import_reverb") {
    const result = await importReverbListings();
    await callCloud({
      action: "complete",
      id: command.id,
      status: "done",
      result: { ok: true, ...result },
    });
    return;
  }

  if (command.kind === "list_ebay") {
    const fresh = await withFreshFields(payload);
    const result = await createEbayListing({
      title: String(fresh.title || ""),
      targetPrice: fresh.price ?? null,
      description: String(fresh.description || ""),
      photoUrls: Array.isArray(fresh.photo_urls) ? fresh.photo_urls : [],
      reverbLinked: !!fresh.reverb_linked,
    });
    await callCloud({
      action: "complete",
      id: command.id,
      status: result.ok ? "done" : "error",
      result,
      inventory_id: payload.inventory_id || null,
      inventory_fields: result.ok ? { ebay_url: result.url, status: "listed" } : undefined,
    });
    return;
  }

  if (command.kind === "list_reverb") {
    const fresh = await withFreshFields(payload);
    const result = await createReverbDraft({
      title: String(fresh.title || ""),
      price: fresh.price ?? null,
      description: String(fresh.description || ""),
      photoUrls: Array.isArray(fresh.photo_urls) ? fresh.photo_urls : [],
      videoUrl: fresh.video_url ? String(fresh.video_url) : null,
    });
    await callCloud({
      action: "complete",
      id: command.id,
      status: result.ok ? "done" : "error",
      result,
      inventory_id: payload.inventory_id || null,
      inventory_fields: result.ok ? { reverb_url: result.url } : undefined,
    });
    return;
  }

  await callCloud({
    action: "complete",
    id: command.id,
    status: "error",
    result: { ok: false, error: `unknown command kind: ${command.kind}` },
  });
}

async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const { commands } = await callCloud({ action: "take" });
    for (const command of commands || []) {
      console.log(`Running command from phone: ${command.kind}`);
      try {
        await runCommand(command);
      } catch (err) {
        console.error(`Command ${command.kind} failed:`, err instanceof Error ? err.message : err);
        await callCloud({
          action: "complete",
          id: command.id,
          status: "error",
          result: { ok: false, error: err instanceof Error ? err.message : String(err) },
        }).catch(() => {});
      }
    }
  } catch {
    // cloud unreachable — next poll will retry
  } finally {
    polling = false;
  }
}

export function startCommandRunner(): void {
  if (!inventoryFnUrl()) {
    console.warn("Command runner disabled — PUBLISH_URL/PUBLISH_KEY not set.");
    return;
  }
  setInterval(() => {
    pollOnce();
  }, POLL_INTERVAL_MS);
  setTimeout(() => pollOnce(), 5_000);
  console.log("Command runner started (phone listing requests, checked every minute).");
}
