import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramChat {
  id: number;
  title?: string;
  is_forum?: boolean;
}

interface ForumTopicPayload {
  name: string;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  edit_date?: number;
  message_thread_id?: number;
  text?: string;
  caption?: string;
  entities?: unknown[];
  caption_entities?: unknown[];
  media_group_id?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  reply_to_message?: {
    message_id?: number;
    forum_topic_created?: ForumTopicPayload;
  };
  forum_topic_created?: ForumTopicPayload;
  forum_topic_edited?: ForumTopicPayload;
  forward_date?: number;
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

function toIso(unixSeconds?: number): string | null {
  if (!unixSeconds) {
    return null;
  }

  return new Date(unixSeconds * 1000).toISOString();
}

function formatSenderName(user?: TelegramUser): string | null {
  if (!user) {
    return null;
  }

  const parts = [user.first_name, user.last_name].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" ");
  }

  return user.username ?? null;
}

function resolveMessage(update: TelegramUpdate): TelegramMessage | null {
  return update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post ?? null;
}

function getTopicId(message: TelegramMessage): number | null {
  if (message.message_thread_id) {
    return message.message_thread_id;
  }

  if (message.chat.is_forum) {
    return 1;
  }

  return null;
}

async function upsertTopic(
  userId: string,
  chatId: number,
  topicId: number,
  topicName: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from("topics").upsert(
    {
      user_id: userId,
      telegram_chat_id: chatId,
      topic_id: topicId,
      topic_name: topicName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,telegram_chat_id,topic_id" },
  );

  if (error) {
    throw new Error(`Failed to upsert topic: ${error.message}`);
  }
}

async function resolveTopicName(
  userId: string,
  message: TelegramMessage,
): Promise<string | null> {
  const topicId = getTopicId(message);
  if (!topicId) {
    return null;
  }

  const inlineTopicName =
    message.forum_topic_created?.name ??
    message.forum_topic_edited?.name ??
    message.reply_to_message?.forum_topic_created?.name ??
    null;

  if (inlineTopicName) {
    await upsertTopic(userId, message.chat.id, topicId, inlineTopicName);
    return inlineTopicName;
  }

  const { data, error } = await supabaseAdmin
    .from("topics")
    .select("topic_name")
    .eq("user_id", userId)
    .eq("telegram_chat_id", message.chat.id)
    .eq("topic_id", topicId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve topic name: ${error.message}`);
  }

  return data?.topic_name ?? null;
}

function isServiceOnlyMessage(message: TelegramMessage): boolean {
  return !message.text && !message.caption && !message.media_group_id;
}

function detectMessageType(message: TelegramMessage): string {
  if (message.text) {
    return "text";
  }

  if (message.caption) {
    return "caption";
  }

  return "service";
}

async function computeContentHash(update: TelegramUpdate): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(update));
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

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

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  if (!update) {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const message = resolveMessage(update);
  if (!message) {
    return new Response(JSON.stringify({ ok: true, skipped: "not_a_message_update" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const topicId = getTopicId(message);
    const topicName = await resolveTopicName(botConnection.user_id, message);
    const contentHash = await computeContentHash(update);
    const isEdit = Boolean(update.edited_message || update.edited_channel_post || message.edit_date);

    if (topicId && topicName) {
      await upsertTopic(botConnection.user_id, message.chat.id, topicId, topicName);
    }

    if (!isServiceOnlyMessage(message)) {
      const { error: upsertError } = await supabaseAdmin.from("messages").upsert(
        {
          user_id: botConnection.user_id,
          telegram_update_id: update.update_id ?? null,
          telegram_message_id: message.message_id,
          telegram_chat_id: message.chat.id,
          telegram_chat_title: message.chat.title ?? null,
          telegram_date: toIso(message.date),
          topic_id: topicId,
          topic_name: topicName,
          sender_name: formatSenderName(message.from),
          sender_username: message.from?.username ?? null,
          sender_id: message.from?.id ?? null,
          message_type: detectMessageType(message),
          text_content: message.text ?? null,
          caption: message.caption ?? null,
          entities: message.entities ?? null,
          caption_entities: message.caption_entities ?? null,
          forward_from_name: null,
          forward_date: toIso(message.forward_date),
          reply_to_message_id: message.reply_to_message?.message_id ?? null,
          media_group_id: message.media_group_id ?? null,
          file_path: null,
          file_name: null,
          file_size: null,
          file_mime_type: null,
          is_edit: isEdit,
          edit_date: toIso(message.edit_date),
          content_hash: contentHash,
          raw_update: update,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,telegram_chat_id,telegram_message_id" },
      );

      if (upsertError) {
        throw new Error(`Failed to upsert message: ${upsertError.message}`);
      }
    }
  } catch (error) {
    console.error("telegram-webhook processing failed", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      user_id: botConnection.user_id,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
