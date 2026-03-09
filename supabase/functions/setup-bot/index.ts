import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function importEncryptionKey(): Promise<CryptoKey> {
  const rawKey = Deno.env.get("BOT_TOKEN_ENCRYPTION_KEY");
  if (!rawKey) {
    throw new Error("Missing BOT_TOKEN_ENCRYPTION_KEY secret.");
  }

  return await crypto.subtle.importKey(
    "raw",
    decodeBase64(rawKey),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptBotToken(botToken: string): Promise<{ ciphertext: string; nonce: string }> {
  const key = await importEncryptionKey();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    new TextEncoder().encode(botToken),
  );

  return {
    ciphertext: encodeBase64(new Uint8Array(encrypted)),
    nonce: encodeBase64(nonce),
  };
}

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
  const encryptedBotToken = await encryptBotToken(botToken);
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
      bot_token_ciphertext: encryptedBotToken.ciphertext,
      bot_token_nonce: encryptedBotToken.nonce,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (upsertError) {
    return new Response(JSON.stringify({ error: upsertError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const webhookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-webhook`;
  const usageWarningCheckUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/usage-warning-check`;
  const webhookResponse = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: [
        "message",
        "edited_message",
        "channel_post",
        "edited_channel_post",
      ],
    }),
  });
  const webhookData = await webhookResponse.json();

  if (!webhookData.ok) {
    return new Response(
      JSON.stringify({
        error: webhookData.description ?? "Telegram setWebhook failed",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const { error: settingError } = await admin.from("internal_settings").upsert(
    {
      key: "usage_warning_check_url",
      value: usageWarningCheckUrl,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  if (settingError) {
    return new Response(JSON.stringify({ error: settingError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      bot_username: meData.result.username,
      telegram_bot_id: meData.result.id,
      webhook_url: webhookUrl,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
