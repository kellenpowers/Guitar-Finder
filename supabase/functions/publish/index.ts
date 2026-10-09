import { createClient } from "jsr:@supabase/supabase-js@2";

// The studio computer pushes each sweep's findings here.
// Deployed copy embeds the real key (see supabase/functions/README.md).
const PUBLISH_KEY = "REPLACED_AT_DEPLOY";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (req.headers.get("x-publish-key") !== PUBLISH_KEY) {
    return new Response("unauthorized", { status: 401 });
  }

  const body = await req.json();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { error } = await supabase
    .from("snapshot")
    .upsert({ id: 1, data: body, updated_at: new Date().toISOString() });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
