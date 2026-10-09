const API_BASE = import.meta.env.VITE_API_URL || "";
// Where the studio computer publishes its findings (the URL is not secret —
// the passcode is what gates the data behind it)
const DEFAULT_SNAPSHOT_URL =
  "https://xcwhcpithgcommwqpgif.supabase.co/functions/v1/snapshot";
const SNAPSHOT_URL = import.meta.env.VITE_SNAPSHOT_URL || DEFAULT_SNAPSHOT_URL;

// Cloud mode: when served from the hosted site (vercel.app), the app is a
// read-only view of the latest published snapshot, gated by a passcode.
// Local mode (localhost / the Mac's address) talks to the server directly.
export const isCloud =
  typeof window !== "undefined" && window.location.hostname.endsWith("vercel.app");

let snapshot: { updatedAt: string | null; listings: any[] } | null = null;

export function getSnapshotUpdatedAt(): string | null {
  return snapshot?.updatedAt ?? null;
}

export function getPasscode(): string {
  try {
    return localStorage.getItem("passcode") || "";
  } catch {
    return "";
  }
}

export function setPasscode(code: string) {
  try {
    localStorage.setItem("passcode", code.trim());
  } catch {
    // private browsing — passcode just won't be remembered
  }
}

export async function loadSnapshot(): Promise<void> {
  const res = await fetch(
    `${SNAPSHOT_URL}?code=${encodeURIComponent(getPasscode())}`
  );
  if (res.status === 401) throw new Error("bad-passcode");
  if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);
  const body = await res.json();
  snapshot = {
    updatedAt: body.updated_at ?? null,
    listings: body.data?.listings || [],
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function cloudApi(path: string, init?: RequestInit): Promise<Response> {
  if (init?.method && init.method !== "GET") {
    return jsonResponse(
      { error: "This is the read-only cloud view — actions run on the studio computer." },
      400
    );
  }
  if (!snapshot) await loadSnapshot();
  const listings = snapshot!.listings;

  const [pathname, query] = path.split("?");
  const params = new URLSearchParams(query || "");

  const detailMatch = pathname.match(/^\/api\/listings\/(\d+)$/);
  if (detailMatch) {
    const found = listings.find((l) => String(l.id) === detailMatch[1]);
    return found ? jsonResponse(found) : jsonResponse({ error: "Not found" }, 404);
  }

  if (pathname === "/api/listings") {
    let result = [...listings];
    const source = params.get("source");
    if (source) result = result.filter((l) => l.source === source);
    const minScore = params.get("minScore");
    if (minScore) result = result.filter((l) => (l.deal_score ?? 0) >= Number(minScore));
    const sortBy = params.get("sortBy");
    if (sortBy === "profit") {
      result.sort((a, b) => (b.est_profit ?? -Infinity) - (a.est_profit ?? -Infinity));
    } else if (sortBy === "score") {
      result.sort((a, b) => (b.deal_score ?? -Infinity) - (a.deal_score ?? -Infinity));
    } else if (sortBy === "price") {
      result.sort((a, b) => a.price - b.price);
    } else if (sortBy === "recent") {
      result.sort((a, b) => (b.scraped_at || "").localeCompare(a.scraped_at || ""));
    }
    // default order is the published order (flip score)
    return jsonResponse(result);
  }

  if (pathname === "/api/searches") return jsonResponse([]);
  if (pathname === "/api/settings") return jsonResponse({});
  return jsonResponse({ error: "Not available in the cloud view" }, 404);
}

export function api(path: string, init?: RequestInit): Promise<Response> {
  if (isCloud) return cloudApi(path, init);
  return fetch(`${API_BASE}${path}`, init);
}
