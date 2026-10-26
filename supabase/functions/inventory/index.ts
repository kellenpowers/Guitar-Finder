import { createClient } from "jsr:@supabase/supabase-js@2";

// Inventory CRUD + photo upload URLs + the command queue that lets the phone
// ask the studio Mac to run listing actions (the Mac holds all API tokens).
// Deployed copy embeds the real values (see supabase/functions/README.md).
const VIEW_PASSCODE = "REPLACED_AT_DEPLOY";
const PUBLISH_KEY = "REPLACED_AT_DEPLOY";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-publish-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const hasPasscode = url.searchParams.get("code") === VIEW_PASSCODE;
  const hasMacKey = req.headers.get("x-publish-key") === PUBLISH_KEY;
  if (!hasPasscode && !hasMacKey) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("inventory")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json({ items: data });
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  // ----- Phone actions (passcode) -----
  if (action === "create") {
    const { data, error } = await supabase
      .from("inventory")
      .insert({
        title: String(body.title || "Untitled item").slice(0, 300),
        bought_price: body.bought_price ?? null,
        target_price: body.target_price ?? null,
        source_url: body.source_url ?? null,
        listing_draft: String(body.listing_draft || ""),
      })
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ item: data });
  }

  if (action === "update") {
    const allowed: Record<string, unknown> = {};
    for (const key of [
      "title", "status", "bought_price", "target_price", "listing_draft", "photos", "video_url",
      // Sale money facts, written by the Mac's sold-sync from the platform order
      "sold_price", "sold_shipping", "sold_fees", "sold_payout", "sold_at", "sold_order", "sold_on",
      // Repricing autopilot state + engagement, written by the Mac's repricer
      "auto_reprice", "repriced_at", "initial_price", "views", "watches",
    ]) {
      if (key in body) allowed[key] = body[key];
    }
    allowed.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from("inventory")
      .update(allowed)
      .eq("id", body.id)
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ item: data });
  }

  if (action === "delete") {
    const { error } = await supabase.from("inventory").delete().eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "uploadUrl") {
    const ext = String(body.ext || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "jpg";
    const path = `inv/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await supabase.storage.from("photos").createSignedUploadUrl(path);
    if (error) return json({ error: error.message }, 500);
    return json({ path, signedUrl: data.signedUrl, token: data.token });
  }

  // Ignored marketplace finds — synced across the owner's devices
  if (action === "ignores") {
    const { data, error } = await supabase.from("ignores").select("key");
    if (error) return json({ error: error.message }, 500);
    return json({ keys: (data || []).map((r: any) => r.key) });
  }

  if (action === "ignore") {
    const key = String(body.key || "").slice(0, 100);
    if (!key) return json({ error: "missing key" }, 400);
    const { error } = await supabase.from("ignores").upsert({ key });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "unignore") {
    const key = String(body.key || "");
    const { error } = await supabase.from("ignores").delete().eq("key", key);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "queue") {
    const kind = String(body.kind || "");
    if (!["list_reverb", "list_ebay", "import_reverb", "identify_item", "manage_search", "revise_price"].includes(kind)) return json({ error: "unknown command" }, 400);
    const { data, error } = await supabase
      .from("commands")
      .insert({ kind, payload: body.payload ?? {} })
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ command: data });
  }

  if (action === "commandStatus") {
    const { data, error } = await supabase
      .from("commands")
      .select("id, kind, status, result, created_at")
      .eq("id", body.id)
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ command: data });
  }

  // ----- Mac actions (publish key) -----
  if (action === "take") {
    if (!hasMacKey) return json({ error: "unauthorized" }, 401);
    const { data, error } = await supabase
      .from("commands")
      .select("*")
      .eq("status", "queued")
      .order("created_at")
      .limit(5);
    if (error) return json({ error: error.message }, 500);
    const ids = (data || []).map((c: any) => c.id);
    if (ids.length > 0) {
      await supabase.from("commands").update({ status: "running", updated_at: new Date().toISOString() }).in("id", ids);
    }
    return json({ commands: data || [] });
  }

  if (action === "complete") {
    if (!hasMacKey) return json({ error: "unauthorized" }, 401);
    const { error } = await supabase
      .from("commands")
      .update({ status: body.status === "done" ? "done" : "error", result: body.result ?? null, updated_at: new Date().toISOString() })
      .eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    if (body.inventory_id && body.inventory_fields) {
      const allowed: Record<string, unknown> = {};
      for (const key of ["status", "reverb_url", "ebay_url"]) {
        if (key in body.inventory_fields) allowed[key] = body.inventory_fields[key];
      }
      if (Object.keys(allowed).length > 0) {
        allowed.updated_at = new Date().toISOString();
        await supabase.from("inventory").update(allowed).eq("id", body.inventory_id);
      }
    }
    return json({ ok: true });
  }

  if (action === "bulkUpsert") {
    if (!hasMacKey) return json({ error: "unauthorized" }, 401);
    const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    let created = 0;
    let updated = 0;
    for (const raw of items) {
      const fields = {
        title: String(raw.title || "Untitled item").slice(0, 300),
        status: raw.status || "listed",
        target_price: raw.target_price ?? null,
        photos: Array.isArray(raw.photos) ? raw.photos : [],
        listing_draft: String(raw.listing_draft || ""),
        reverb_url: raw.reverb_url ?? null,
        updated_at: new Date().toISOString(),
      };
      if (fields.reverb_url) {
        const { data: existing } = await supabase
          .from("inventory")
          .select("id")
          .eq("reverb_url", fields.reverb_url)
          .maybeSingle();
        if (existing) {
          await supabase.from("inventory").update(fields).eq("id", existing.id);
          updated++;
          continue;
        }
      }
      await supabase.from("inventory").insert(fields);
      created++;
    }
    return json({ created, updated });
  }

  return json({ error: "unknown action" }, 400);
});
