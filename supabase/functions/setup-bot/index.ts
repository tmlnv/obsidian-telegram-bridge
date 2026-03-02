import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    {
      global: {
        headers: {
          Authorization: request.headers.get("Authorization") ?? "",
        },
      },
    },
  );

  const {
    data: { user },
    error,
  } = await userClient.auth.getUser();

  if (error || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await request.json().catch(() => null);
  const botToken = body?.bot_token;

  if (typeof botToken !== "string" || botToken.length === 0) {
    return new Response(JSON.stringify({ error: "bot_token is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const meResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const meData = await meResponse.json();

  if (!meData.ok) {
    return new Response(JSON.stringify({ error: "Invalid Telegram bot token" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const webhookSecret = crypto.randomUUID();
  const tokenBytes = new TextEncoder().encode(botToken);
  const hashBuffer = await crypto.subtle.digest("SHA-256", tokenBytes);
  const botTokenHash = Array.from(new Uint8Array(hashBuffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  const { error: upsertError } = await admin.from("bot_connections").upsert(
    {
      user_id: user.id,
      telegram_bot_id: meData.result.id,
      bot_token_hash: botTokenHash,
      webhook_secret: webhookSecret,
    },
    { onConflict: "user_id" },
  );

  if (upsertError) {
    return new Response(JSON.stringify({ error: upsertError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      bot_username: meData.result.username,
      note: "Webhook registration and encrypted bot-token storage are the next implementation steps.",
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
