export interface TopicNameCacheItem {
  name: string;
  chat_id: number;
  topic_id: number;
}

export interface PluginSettings {
  supabase_url: string;
  supabase_anon_key: string;
  client_id: string;
  email: string;
  poll_interval_seconds: number;
  is_realtime_enabled: boolean;
  topic_names: TopicNameCacheItem[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  supabase_url: "",
  supabase_anon_key: "",
  client_id: "",
  email: "",
  poll_interval_seconds: 30,
  is_realtime_enabled: false,
  topic_names: [],
};
