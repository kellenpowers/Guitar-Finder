import { createClient } from "jsr:@supabase/supabase-js@2";

// The phone/web app reads the latest findings here, gated by a passcode.
// Deployed copy embeds the real passcode (see supabase/functions/README.md).
const VIEW_PASSCODE = "REPLACED_AT_DEPLOY";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const code = new URL(req.url).searchParams.get("code");
  if (code !== VIEW_PASSCODE) {
    return new Response(JSON.stringify({ error: "bad passcode" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data, error } = await supabase
    .from("snapshot")
    .select("data, updated_at")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify(data ?? { data: null, updated_at: null }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
});
