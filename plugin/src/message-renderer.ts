import { normalizePath } from "obsidian";
import type { DistributionRule, MessageRow, PluginSettings } from "./types";
import { expandTemplate } from "./template-engine";

const BLOCK_END_MARKER = "<!-- /telegram-sync -->";

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
  const template = settings.default_note_path_template || "Telegram/{{chat}}/{{topic}}Messages.md";
  return normalizePath(expandTemplate(template, message, { isPath: true }));
}

export function renderMessageBlock(
  message: MessageRow,
  rule?: DistributionRule,
  settings?: PluginSettings,
  attachmentMarkdown?: string,
): string {
  const marker = buildMessageMarker(message);
  const template =
    rule?.message_template ??
    settings?.default_message_template ??
    "- {{messageDate:YYYY-MM-DD HH:mm:ss}} {{user}}\n\n  {{content}}";
  const body = expandTemplate(template, message).trimEnd();
  const lines = [marker, body];
  if (attachmentMarkdown) {
    lines.push("", attachmentMarkdown);
  }
  lines.push(BLOCK_END_MARKER);
  return `${lines.join("\n")}\n`;
}
