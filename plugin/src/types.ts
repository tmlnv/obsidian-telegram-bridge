export interface TopicNameCacheItem {
  name: string;
  chat_id: number;
  topic_id: number;
}

export interface MessageRow {
  id: number;
  user_id: string;
  telegram_update_id: number | null;
  telegram_message_id: number;
  telegram_chat_id: number;
  telegram_chat_title: string | null;
  telegram_date: string;
  topic_id: number | null;
  topic_name: string | null;
  sender_name: string | null;
  sender_username: string | null;
  sender_id: number | null;
  message_type: string;
  text_content: string | null;
  caption: string | null;
  entities: unknown[] | null;
  caption_entities: unknown[] | null;
  forward_from_name: string | null;
  forward_date: string | null;
  reply_to_message_id: number | null;
  media_group_id: string | null;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  file_mime_type: string | null;
  is_edit: boolean;
  edit_date: string | null;
  content_hash: string | null;
  raw_update: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SyncClientRow {
  id: string;
  user_id: string;
  client_name: string;
  vault_fingerprint: string | null;
  platform: string | null;
  plugin_version: string | null;
  last_processed_message_created_at: string | null;
  last_processed_message_id: number | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncCursor {
  last_processed_message_created_at: string | null;
  last_processed_message_id: number | null;
}

export type FilterOperation = "=" | "!=" | "~" | "!~";

export type ConditionType = "all" | "chat" | "topic" | "user" | "content";

export interface FilterCondition {
  type: ConditionType;
  operation: FilterOperation;
  value: string;
}

export interface DistributionRule {
  filter_query: string;
  note_path_template: string;
  message_template: string;
}

export function createDefaultDistributionRule(): DistributionRule {
  return {
    filter_query: "{{all}}",
    note_path_template: "Telegram/{{chat}}/{{topic}}Messages.md",
    message_template:
      "- {{messageDate:YYYY-MM-DD HH:mm:ss}} {{user}}\n  - Chat: {{chat}}\n  - Type: {{messageType}}\n\n  {{content}}",
  };
}

export interface PluginSettings {
  supabase_url: string;
  supabase_anon_key: string;
  client_id: string;
  email: string;
  default_note_folder: string;
  default_note_path_template: string;
  default_message_template: string;
  distribution_rules: DistributionRule[];
  poll_interval_seconds: number;
  is_realtime_enabled: boolean;
  topic_names: TopicNameCacheItem[];
}

export const DEFAULT_DISTRIBUTION_RULE: DistributionRule = createDefaultDistributionRule();

export const DEFAULT_SETTINGS: PluginSettings = {
  supabase_url: "",
  supabase_anon_key: "",
  client_id: "",
  email: "",
  default_note_folder: "Telegram",
  default_note_path_template: DEFAULT_DISTRIBUTION_RULE.note_path_template,
  default_message_template: DEFAULT_DISTRIBUTION_RULE.message_template,
  distribution_rules: [createDefaultDistributionRule()],
  poll_interval_seconds: 30,
  is_realtime_enabled: false,
  topic_names: [],
};
