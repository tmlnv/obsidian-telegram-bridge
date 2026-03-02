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

interface TelegramFileDescriptor {
  file_id?: string;
  file_unique_id?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
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
  photo?: TelegramFileDescriptor[];
  document?: TelegramFileDescriptor;
  video?: TelegramFileDescriptor;
  audio?: TelegramFileDescriptor;
  voice?: TelegramFileDescriptor;
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

interface BotConnectionRow {
  user_id: string;
  webhook_secret: string;
  bot_token_ciphertext: string | null;
  bot_token_nonce: string | null;
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

async function resolveTopicName(userId: string, message: TelegramMessage): Promise<string | null> {
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

function getTelegramFile(message: TelegramMessage): TelegramFileDescriptor | null {
  if (message.photo?.length) {
    return message.photo[message.photo.length - 1];
  }

  return message.document ?? message.video ?? message.audio ?? message.voice ?? null;
}

function isServiceOnlyMessage(message: TelegramMessage): boolean {
  return !message.text && !message.caption && !getTelegramFile(message) && !message.media_group_id;
}

function detectMessageType(message: TelegramMessage): string {
  if (message.photo?.length) {
    return "photo";
  }
  if (message.document) {
    return "document";
  }
  if (message.video) {
    return "video";
  }
  if (message.audio) {
    return "audio";
  }
  if (message.voice) {
    return "voice";
  }
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

async function downloadTelegramFile(
  botToken: string,
  fileId: string,
): Promise<{ data: ArrayBuffer; filePath: string }> {
  const metadataResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const metadata = await metadataResponse.json();

  if (!metadata.ok || !metadata.result?.file_path) {
    throw new Error(metadata.description ?? "Failed to resolve Telegram file.");
  }

  const filePath = metadata.result.file_path as string;
  const fileResponse = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);

  if (!fileResponse.ok) {
    throw new Error(`Failed to download Telegram file: ${fileResponse.status}`);
  }

  return {
    data: await fileResponse.arrayBuffer(),
    filePath,
  };
}

function resolveFileExtension(file: TelegramFileDescriptor): string {
  if (file.file_name?.includes(".")) {
    return `.${file.file_name.split(".").pop()}`;
  }

  const suffix = file.mime_type?.split("/").pop() ?? "";
  if (!suffix) {
    return "";
  }

  return suffix === "jpeg" ? ".jpg" : `.${suffix}`;
}

async function uploadTelegramFile(
  userId: string,
  message: TelegramMessage,
  botToken: string,
): Promise<{
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  file_mime_type: string | null;
}> {
  const file = getTelegramFile(message);
  if (!file?.file_id) {
    return {
      file_path: null,
      file_name: null,
      file_size: null,
      file_mime_type: null,
    };
  }

  const downloaded = await downloadTelegramFile(botToken, file.file_id);
  const storagePath = `${userId}/${detectMessageType(message)}s/${message.chat.id}/${message.message_id}_${file.file_unique_id ?? "file"}${resolveFileExtension(file)}`;

  const { error } = await supabaseAdmin.storage.from("telegram-files").upload(storagePath, downloaded.data, {
    contentType: file.mime_type ?? undefined,
    upsert: true,
  });

  if (error) {
    throw new Error(`Failed to upload Telegram file: ${error.message}`);
  }

  return {
    file_path: storagePath,
    file_name: file.file_name ?? downloaded.filePath.split("/").pop() ?? null,
    file_size: file.file_size ?? null,
    file_mime_type: file.mime_type ?? null,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: botConnection, error } = (await supabaseAdmin
    .from("bot_connections")
    .select("user_id, webhook_secret, bot_token_ciphertext, bot_token_nonce")
    .eq("webhook_secret", secret)
    .maybeSingle()) as { data: BotConnectionRow | null; error: { message: string } | null };

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
    if (!botConnection.bot_token_ciphertext || !botConnection.bot_token_nonce) {
      throw new Error("Bot token is not stored for this connection.");
    }

    const botToken = await decryptBotToken(
      botConnection.bot_token_ciphertext,
      botConnection.bot_token_nonce,
    );
    const topicId = getTopicId(message);
    const topicName = await resolveTopicName(botConnection.user_id, message);
    const contentHash = await computeContentHash(update);
    const isEdit = Boolean(update.edited_message || update.edited_channel_post || message.edit_date);
    const uploadedFile = await uploadTelegramFile(botConnection.user_id, message, botToken);

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
          file_path: uploadedFile.file_path,
          file_name: uploadedFile.file_name,
          file_size: uploadedFile.file_size,
          file_mime_type: uploadedFile.file_mime_type,
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
  } catch (caughtError) {
    console.error("telegram-webhook processing failed", caughtError);
    return new Response(
      JSON.stringify({
        error: caughtError instanceof Error ? caughtError.message : String(caughtError),
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
