import type { MessageRow } from "./types";

interface ExpandOptions {
  isPath?: boolean;
}

function sanitizePath(value: string): string {
  return value
    .replace(/[\\:*?"<>|\n\r]/g, "_")
    .replace(/\/+/g, "/")
    .replace(/(^\/|\/$)/g, "");
}

function normalizeTemplatePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/\.\//g, "/")
    .replace(/(^\/|\/$)/g, "");
}

function sliceContent(value: string, length?: string): string {
  if (!length) {
    return value;
  }

  const parsed = Number.parseInt(length, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return value;
  }

  return value.slice(0, parsed);
}

function formatDate(iso: string, format: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, "0");

  return format
    .replace(/YYYY/g, String(date.getUTCFullYear()))
    .replace(/MM/g, pad(date.getUTCMonth() + 1))
    .replace(/DD/g, pad(date.getUTCDate()))
    .replace(/HH/g, pad(date.getUTCHours()))
    .replace(/mm/g, pad(date.getUTCMinutes()))
    .replace(/ss/g, pad(date.getUTCSeconds()));
}

function getContent(message: MessageRow): string {
  return message.text_content ?? message.caption ?? "";
}

function getChatLabel(message: MessageRow): string {
  return message.telegram_chat_title ?? String(message.telegram_chat_id);
}

function getTopicLabel(message: MessageRow): string {
  return message.topic_name ? `${message.topic_name}/` : "";
}

function getUserLabel(message: MessageRow): string {
  return message.sender_username
    ? `@${message.sender_username}`
    : message.sender_name ?? "Unknown sender";
}

function getFileBaseName(message: MessageRow): string {
  if (!message.file_name) {
    return `message-${message.telegram_message_id}`;
  }

  const parts = message.file_name.split(".");
  if (parts.length <= 1) {
    return message.file_name;
  }

  parts.pop();
  return parts.join(".") || `message-${message.telegram_message_id}`;
}

function getFileExtension(message: MessageRow): string {
  if (message.file_name?.includes(".")) {
    return message.file_name.split(".").pop() ?? "";
  }

  if (!message.file_mime_type) {
    return "";
  }

  const suffix = message.file_mime_type.split("/").pop() ?? "";
  return suffix === "jpeg" ? "jpg" : suffix;
}

export function expandTemplate(
  template: string,
  message: MessageRow,
  options: ExpandOptions = {},
): string {
  const content = getContent(message);
  let result = template;

  result = result.replace(/\{\{messageDate:([^}]+)\}\}/g, (_match, format) =>
    formatDate(message.telegram_date, format),
  );
  result = result.replace(/\{\{content(?::(\d+))?\}\}/g, (_match, length) =>
    sliceContent(content, length),
  );
  result = result.replace(/\{\{chatId\}\}/g, String(message.telegram_chat_id));
  result = result.replace(/\{\{chat\}\}/g, getChatLabel(message));
  result = result.replace(/\{\{topicId\}\}/g, message.topic_id ? String(message.topic_id) : "");
  result = result.replace(/\{\{topic\}\}/g, getTopicLabel(message));
  result = result.replace(/\{\{user\}\}/g, getUserLabel(message));
  result = result.replace(/\{\{messageId\}\}/g, String(message.telegram_message_id));
  result = result.replace(/\{\{messageType\}\}/g, message.message_type);
  result = result.replace(/\{\{file:name\}\}/g, getFileBaseName(message));
  result = result.replace(/\{\{file:extension\}\}/g, getFileExtension(message));

  if (options.isPath) {
    return normalizeTemplatePath(sanitizePath(result));
  }

  return result;
}
