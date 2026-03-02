import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: botConnection, error } = await supabaseAdmin
    .from("bot_connections")
    .select("user_id, webhook_secret")
    .eq("webhook_secret", secret)
    .maybeSingle();

  if (error || !botConnection) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update = await request.json().catch(() => null);
  if (!update) {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      user_id: botConnection.user_id,
      note: "Webhook normalization, topic extraction, and message upsert remain to be implemented.",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
