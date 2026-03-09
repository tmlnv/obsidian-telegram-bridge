import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

interface BotConnectionRow {
  user_id: string;
  bot_token_ciphertext: string | null;
  bot_token_nonce: string | null;
}

interface UsageEstimateRow {
  message_count: number;
  file_count: number;
  estimated_database_bytes: number;
  estimated_file_bytes: number;
  estimated_total_bytes: number;
}

interface UserPreferenceRow {
  user_id: string;
  estimated_storage_limit_bytes: number;
  warning_threshold_percent: number;
  telegram_warnings_enabled: boolean;
  notification_chat_id: number | null;
  last_storage_warning_sent_at: string | null;
  last_storage_warning_threshold_percent: number | null;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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
    ["decrypt"],
  );
}

async function decryptBotToken(ciphertext: string, nonce: string): Promise<string> {
  const key = await importEncryptionKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64(nonce) },
    key,
    decodeBase64(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

async function loadBotConnection(userId: string): Promise<BotConnectionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("bot_connections")
    .select("user_id, bot_token_ciphertext, bot_token_nonce")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load bot connection: ${error.message}`);
  }

  return (data as BotConnectionRow | null) ?? null;
}

async function loadUserPreferences(userId: string): Promise<UserPreferenceRow | null> {
  const { data, error } = await supabaseAdmin
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load usage preferences: ${error.message}`);
  }

  return (data as UserPreferenceRow | null) ?? null;
}

async function getUsageEstimateForUser(userId: string): Promise<UsageEstimateRow> {
  const { data, error } = await supabaseAdmin.rpc("get_usage_estimate", {
    p_user_id: userId,
  });

  if (error) {
    throw new Error(`Failed to calculate usage estimate: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as UsageEstimateRow | null;
  return (
    row ?? {
      message_count: 0,
      file_count: 0,
      estimated_database_bytes: 0,
      estimated_file_bytes: 0,
      estimated_total_bytes: 0,
    }
  );
}

async function clearUsageWarningState(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("user_preferences")
    .update({
      last_storage_warning_threshold_percent: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to reset warning state: ${error.message}`);
  }
}

async function markUsageWarningSent(userId: string, thresholdPercent: number): Promise<void> {
  const { error } = await supabaseAdmin
    .from("user_preferences")
    .update({
      last_storage_warning_sent_at: new Date().toISOString(),
      last_storage_warning_threshold_percent: thresholdPercent,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to persist warning state: ${error.message}`);
  }
}

async function sendTelegramMessage(botToken: string, chatId: number, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description ?? `Failed to send Telegram warning: ${response.status}`);
  }
}

async function maybeSendUsageWarning(userId: string): Promise<"not_applicable" | "sent" | "no_change"> {
  const preferences = await loadUserPreferences(userId);
  if (!preferences) {
    return "not_applicable";
  }

  const usageEstimate = await getUsageEstimateForUser(userId);
  const limitBytes = preferences.estimated_storage_limit_bytes;

  if (!preferences.telegram_warnings_enabled || !preferences.notification_chat_id || limitBytes <= 0) {
    if (preferences.last_storage_warning_threshold_percent !== null) {
      await clearUsageWarningState(userId);
    }
    return "not_applicable";
  }

  const usagePercent = Math.round((usageEstimate.estimated_total_bytes / limitBytes) * 100);
  if (usagePercent < preferences.warning_threshold_percent) {
    if (preferences.last_storage_warning_threshold_percent !== null) {
      await clearUsageWarningState(userId);
    }
    return "no_change";
  }

  if (preferences.last_storage_warning_threshold_percent === preferences.warning_threshold_percent) {
    return "no_change";
  }

  const botConnection = await loadBotConnection(userId);
  if (!botConnection?.bot_token_ciphertext || !botConnection.bot_token_nonce) {
    return "not_applicable";
  }

  const botToken = await decryptBotToken(botConnection.bot_token_ciphertext, botConnection.bot_token_nonce);
  const warningMessage =
    `Storage warning: estimated Supabase usage is ${usagePercent}% of your configured limit.\n` +
    `Used: ${formatBytes(usageEstimate.estimated_total_bytes)} of ${formatBytes(limitBytes)}.\n` +
    `Messages: ${usageEstimate.message_count}. Files: ${usageEstimate.file_count}.\n` +
    `Open the Obsidian plugin settings to review the estimate and adjust the threshold if needed.`;

  await sendTelegramMessage(botToken, preferences.notification_chat_id, warningMessage);
  await markUsageWarningSent(userId, preferences.warning_threshold_percent);
  return "sent";
}

async function loadPendingUsers(limit: number): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("pending_usage_warning_checks")
    .select("user_id")
    .order("requested_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load pending usage checks: ${error.message}`);
  }

  return (data ?? []).map((row) => String(row.user_id));
}

async function deletePendingUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  const { error } = await supabaseAdmin.from("pending_usage_warning_checks").delete().in("user_id", userIds);
  if (error) {
    throw new Error(`Failed to delete processed usage checks: ${error.message}`);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const pendingUsers = await loadPendingUsers(100);
  const processedUsers: string[] = [];
  const failedUsers: { user_id: string; error: string }[] = [];
  let sentCount = 0;

  for (const userId of pendingUsers) {
    try {
      const result = await maybeSendUsageWarning(userId);
      if (result === "sent") {
        sentCount += 1;
      }
      processedUsers.push(userId);
    } catch (error) {
      failedUsers.push({
        user_id: userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await deletePendingUsers(processedUsers);

  return new Response(
    JSON.stringify({
      processed_users: processedUsers.length,
      sent_warnings: sentCount,
      failed_users: failedUsers,
      remaining_queue_estimate: Math.max(0, pendingUsers.length - processedUsers.length),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
