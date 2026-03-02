import { Notice, Plugin } from "obsidian";
import {
  createDefaultDistributionRule,
  DEFAULT_SETTINGS,
  type PluginSettings,
} from "./types";
import { ObsidianTelegramSettingTab } from "./settings-tab";
import { StatusIndicator } from "./status-indicator";
import {
  destroySupabase,
  getSession,
  initSupabase,
  restoreSession,
  signIn,
  signOut,
} from "./supabase-client";
import { SyncEngine } from "./sync-engine";
import { buildDefaultNotePath, buildMessageMarker, getBlockEndMarker, renderMessageBlock } from "./message-renderer";
import { saveBinaryFile, upsertMessageBlock } from "./vault-writer";
import type { MessageRow } from "./types";
import { findMatchingRule } from "./distribution-rules";
import { expandTemplate } from "./template-engine";

function createClientId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `client-${Date.now()}`;
}

export default class ObsidianTelegramPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private statusIndicator: StatusIndicator | null = null;
  private syncEngine: SyncEngine | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    if (!this.settings.client_id) {
      this.settings.client_id = createClientId();
      await this.saveSettings();
    }

    this.statusIndicator = new StatusIndicator(this);
    this.statusIndicator.setIdle();

    this.addSettingTab(new ObsidianTelegramSettingTab(this));

    if (this.isSupabaseConfigured()) {
      await this.initializeSupabaseFromSettings();
    }

    this.addCommand({
      id: "show-client-id",
      name: "Show Obsidian Telegram client ID",
      callback: () => {
        this.statusIndicator?.setConnected();
        console.log("Obsidian Telegram client_id:", this.settings.client_id);
      },
    });

    this.addCommand({
      id: "sync-now",
      name: "Sync Telegram messages now",
      callback: () => {
        void this.manualSync();
      },
    });
  }

  onunload(): void {
    this.syncEngine?.stop();
    this.syncEngine = null;
    this.statusIndicator?.destroy();
    this.statusIndicator = null;
    destroySupabase();
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      distribution_rules: this.normalizeDistributionRules(loaded?.distribution_rules),
    };

    if (!this.settings.default_note_path_template) {
      this.settings.default_note_path_template = this.settings.distribution_rules[0].note_path_template;
    }

    if (!this.settings.default_message_template) {
      this.settings.default_message_template = this.settings.distribution_rules[0].message_template;
    }

    if (!this.settings.default_file_path_template) {
      this.settings.default_file_path_template = this.settings.distribution_rules[0].file_path_template;
    }
  }

  async saveSettings(): Promise<void> {
    this.settings.distribution_rules = this.normalizeDistributionRules(this.settings.distribution_rules);
    await this.saveData(this.settings);
  }

  isSupabaseConfigured(): boolean {
    return Boolean(this.settings.supabase_url && this.settings.supabase_anon_key);
  }

  async reinitializeSupabase(): Promise<void> {
    this.syncEngine?.stop();
    this.syncEngine = null;
    destroySupabase();
    this.statusIndicator?.setIdle();

    if (!this.isSupabaseConfigured()) {
      return;
    }

    await this.initializeSupabaseFromSettings();
  }

  async authenticate(email: string, password: string): Promise<void> {
    if (!this.isSupabaseConfigured()) {
      throw new Error("Configure Supabase URL and anon key first.");
    }

    initSupabase(this.settings.supabase_url, this.settings.supabase_anon_key);
    const session = await signIn(email, password);
    this.settings.email = session.user.email ?? email;
    await this.saveSettings();
    await this.startSync();
    this.statusIndicator?.setConnected();
  }

  async logout(): Promise<void> {
    if (!getSession()) {
      this.statusIndicator?.setDisconnected();
      return;
    }

    await signOut();
    this.syncEngine?.stop();
    this.syncEngine = null;
    this.statusIndicator?.setDisconnected();
  }

  async manualSync(): Promise<void> {
    if (!this.syncEngine) {
      new Notice("Telegram sync is not connected.");
      return;
    }

    this.statusIndicator?.setSyncing();
    await this.syncEngine.poll();
    this.statusIndicator?.setConnected();
  }

  async setupBot(botToken: string): Promise<{ bot_username: string; webhook_url?: string }> {
    if (!this.isSupabaseConfigured()) {
      throw new Error("Configure Supabase URL and anon key first.");
    }

    const session = getSession();
    if (!session) {
      throw new Error("Sign in before setting up the Telegram bot.");
    }

    const response = await fetch(`${this.settings.supabase_url}/functions/v1/setup-bot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: this.settings.supabase_anon_key,
      },
      body: JSON.stringify({ bot_token: botToken }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; bot_username?: string; webhook_url?: string }
      | null;

    if (!response.ok) {
      throw new Error(payload?.error ?? `Bot setup failed with status ${response.status}.`);
    }

    if (!payload?.bot_username) {
      throw new Error("Bot setup succeeded but the response was incomplete.");
    }

    return {
      bot_username: payload.bot_username,
      webhook_url: payload.webhook_url,
    };
  }

  getSessionEmail(): string {
    return getSession()?.user.email ?? "";
  }

  hasSession(): boolean {
    return Boolean(getSession());
  }

  private async initializeSupabaseFromSettings(): Promise<void> {
    try {
      initSupabase(this.settings.supabase_url, this.settings.supabase_anon_key);
      const session = await restoreSession();

      if (!session) {
        this.statusIndicator?.setDisconnected();
        return;
      }

      this.settings.email = session.user.email ?? this.settings.email;
      await this.saveSettings();
      await this.startSync();
      this.statusIndicator?.setConnected();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statusIndicator?.setError(message);
      new Notice(`Obsidian Telegram initialization failed: ${message}`);
    }
  }

  private async startSync(): Promise<void> {
    this.syncEngine?.stop();

    this.syncEngine = new SyncEngine({
      clientId: this.settings.client_id,
      clientName: `${this.app.vault.getName()} plugin client`,
      pluginVersion: this.manifest.version,
      vaultFingerprint: this.app.vault.getName(),
      pollIntervalSeconds: this.settings.poll_interval_seconds,
      isRealtimeEnabled: this.settings.is_realtime_enabled,
      onMessages: async (messages) => {
        await this.processMessages(messages);
      },
      onError: (error) => {
        this.statusIndicator?.setError(error.message);
        console.error("Obsidian Telegram sync failed:", error);
      },
    });

    await this.syncEngine.start();
  }

  private async processMessages(messages: MessageRow[]): Promise<void> {
    this.statusIndicator?.setSyncing();

    for (const message of messages) {
      await this.processMessage(message);
    }

    this.statusIndicator?.setConnected();
  }

  private async processMessage(message: MessageRow): Promise<void> {
    const rule = findMatchingRule(message, this.settings.distribution_rules);
    const notePath = rule
      ? expandTemplate(rule.note_path_template, message, { isPath: true })
      : buildDefaultNotePath(message, this.settings);
    const marker = buildMessageMarker(message);
    const attachmentMarkdown = await this.processAttachment(message, rule);
    const blockContent = renderMessageBlock(message, rule, this.settings, attachmentMarkdown);

    await upsertMessageBlock(
      this.app.vault,
      notePath,
      marker,
      getBlockEndMarker(),
      blockContent,
    );
  }

  private async processAttachment(
    message: MessageRow,
    rule?: PluginSettings["distribution_rules"][number],
  ): Promise<string | undefined> {
    if (!message.file_path || !this.syncEngine) {
      return undefined;
    }

    const fileTemplate =
      rule?.file_path_template ||
      this.settings.default_file_path_template ||
      createDefaultDistributionRule().file_path_template;
    const targetPath = expandTemplate(fileTemplate, message, { isPath: true });
    const data = await this.syncEngine.downloadFile(message.file_path);
    const savedPath = await saveBinaryFile(this.app.vault, targetPath, data);

    if (this.isEmbeddableMimeType(message.file_mime_type)) {
      return `![[${savedPath}]]`;
    }

    return `[[${savedPath}]]`;
  }

  private isEmbeddableMimeType(mimeType: string | null): boolean {
    return Boolean(mimeType && /^(image|audio|video)\//.test(mimeType));
  }

  private normalizeDistributionRules(rules: unknown): PluginSettings["distribution_rules"] {
    if (!Array.isArray(rules) || rules.length === 0) {
      return [createDefaultDistributionRule()];
    }

    const normalized = rules
      .map((rule) => {
        if (!rule || typeof rule !== "object") {
          return null;
        }

        const candidate = rule as Partial<PluginSettings["distribution_rules"][number]>;
        return {
          filter_query: candidate.filter_query?.trim() || "{{all}}",
          note_path_template:
            candidate.note_path_template?.trim() || createDefaultDistributionRule().note_path_template,
          file_path_template:
            candidate.file_path_template?.trim() || createDefaultDistributionRule().file_path_template,
          message_template:
            candidate.message_template?.trim() || createDefaultDistributionRule().message_template,
        };
      })
      .filter((rule): rule is PluginSettings["distribution_rules"][number] => rule !== null);

    return normalized.length > 0 ? normalized : [createDefaultDistributionRule()];
  }
}
