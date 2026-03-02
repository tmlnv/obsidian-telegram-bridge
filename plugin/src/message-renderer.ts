import { normalizePath } from "obsidian";
import type { MessageRow, PluginSettings } from "./types";

const BLOCK_END_MARKER = "<!-- /telegram-sync -->";

function sanitizePathSegment(value: string): string {
  return value.replace(/[\\/:*?"<>|\n\r]/g, "_").trim().slice(0, 80) || "unknown";
}

function getMessageBody(message: MessageRow): string {
  return message.text_content ?? message.caption ?? "";
}

function formatSender(message: MessageRow): string {
  return message.sender_username
    ? `@${message.sender_username}`
    : message.sender_name || "Unknown sender";
}

function formatChatLabel(message: MessageRow): string {
  return message.telegram_chat_title || String(message.telegram_chat_id);
}

function formatTopicLabel(message: MessageRow): string {
  return message.topic_name || (message.topic_id ? `Topic ${message.topic_id}` : "General");
}

export function buildMessageMarker(message: MessageRow): string {
  return `<!-- telegram-sync:chat=${message.telegram_chat_id} message=${message.telegram_message_id} -->`;
}

export function getBlockEndMarker(): string {
  return BLOCK_END_MARKER;
}

export function buildDefaultNotePath(
  message: MessageRow,
  settings: PluginSettings,
): string {
  const baseFolder = settings.default_note_folder || "Telegram";
  const chatFolder = sanitizePathSegment(formatChatLabel(message));
  const topicFolder = message.topic_id ? sanitizePathSegment(formatTopicLabel(message)) : null;

  const parts = [baseFolder, chatFolder];
  if (topicFolder) {
    parts.push(topicFolder);
  }

  parts.push("Messages.md");
  return normalizePath(parts.join("/"));
}

export function renderMessageBlock(message: MessageRow): string {
  const marker = buildMessageMarker(message);
  const dateLabel = new Date(message.telegram_date).toISOString();
  const heading = `- ${dateLabel} ${formatSender(message)}`;
  const lines = [
    marker,
    heading,
    `  - Chat: ${formatChatLabel(message)}`,
    `  - Type: ${message.message_type}`,
  ];

  if (message.topic_id || message.topic_name) {
    lines.push(`  - Topic: ${formatTopicLabel(message)}`);
  }

  if (message.is_edit) {
    lines.push("  - Edited: true");
  }

  if (message.edit_date) {
    lines.push(`  - Edit date: ${message.edit_date}`);
  }

  const body = getMessageBody(message).trim();
  if (body) {
    lines.push("");
    for (const line of body.split("\n")) {
      lines.push(`  ${line}`);
    }
  }

  if (message.file_name || message.file_path) {
    lines.push("");
    lines.push(`  - File: ${message.file_name ?? message.file_path ?? "attachment"}`);
  }

  lines.push(BLOCK_END_MARKER);
  return `${lines.join("\n")}\n`;
}
