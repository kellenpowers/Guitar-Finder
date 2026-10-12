import { createClient } from "jsr:@supabase/supabase-js@2";

// Inventory CRUD + photo upload URLs for the Flip Finder app, gated by the
// same passcode as the snapshot view.
// Deployed copy embeds the real passcode (see supabase/functions/README.md).
const VIEW_PASSCODE = "REPLACED_AT_DEPLOY";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
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
  if (url.searchParams.get("code") !== VIEW_PASSCODE) {
    return json({ error: "bad passcode" }, 401);
  }

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
    for (const key of ["title", "status", "bought_price", "target_price", "listing_draft", "photos"]) {
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
    const { data, error } = await supabase.storage
      .from("photos")
      .createSignedUploadUrl(path);
    if (error) return json({ error: error.message }, 500);
    return json({ path, signedUrl: data.signedUrl, token: data.token });
  }

  return json({ error: "unknown action" }, 400);
});
