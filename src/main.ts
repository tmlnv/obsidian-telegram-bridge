import { Notice, Platform, Plugin, requestUrl } from "obsidian";
import {
  createDefaultDistributionRule,
  DEFAULT_SETTINGS,
  type PluginSettings,
} from "./types";
import { ObsidianTelegramSettingTab } from "./settings-tab";
import { StatusIndicator } from "./status-indicator";
import {
  completeEmailOtp,
  destroySupabase,
  getClient,
  getSession,
  initSupabase,
  requestEmailOtp,
  restoreSession,
  signIn,
  signOut,
} from "./supabase-client";
import { SyncEngine } from "./sync-engine";
import { buildDefaultNotePath, buildMessageMarker, getBlockEndMarker, renderMessageBlock } from "./message-renderer";
import { saveBinaryFile, upsertMessageBlock } from "./vault-writer";
import type {
  MessageRow,
  UsageEstimateRow,
  UserPreferencesRow,
} from "./types";
import { findMatchingRule } from "./distribution-rules";
import { expandTemplate } from "./template-engine";

function createClientId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `client-${Date.now()}`;
}

export default class ObsidianTelegramPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private statusIndicator: StatusIndicator | null = null;
  private syncEngine: SyncEngine | null = null;
  private latestUsageEstimate: UsageEstimateRow | null = null;
  private latestUserPreferences: UserPreferencesRow | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    if (!this.settings.client_id) {
      this.settings.client_id = createClientId();
      await this.saveSettings();
    }

    if (Platform.isDesktopApp) {
      this.statusIndicator = new StatusIndicator(this);
      this.statusIndicator.setIdle();
    }

    this.addSettingTab(new ObsidianTelegramSettingTab(this));

    if (this.isSupabaseConfigured()) {
      await this.initializeSupabaseFromSettings();
    }

    this.addCommand({
      id: "show-client-id",
      name: "Show client ID",
      callback: () => {
        new Notice(`Client ID: ${this.settings.client_id}`);
      },
    });

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => {
        void this.manualSync();
      },
    });

    this.addCommand({
      id: "reconnect",
      name: "Reconnect",
      callback: () => {
        void this.reinitializeSupabase().catch((error) => {
          new Notice(error instanceof Error ? error.message : String(error));
        });
      },
    });

    this.addCommand({
      id: "sign-out",
      name: "Sign out",
      checkCallback: (checking) => {
        if (!this.hasSession()) {
          return false;
        }
        if (!checking) {
          void this.logout().catch((error) => {
            new Notice(error instanceof Error ? error.message : String(error));
          });
        }
        return true;
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
    const loaded = (await this.loadData()) as Partial<PluginSettings> | null;
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
    await this.syncUserPreferencesFromServer();
    await this.startSync();
    this.updateStatusIndicator();
  }

  async sendEmailCode(email: string): Promise<void> {
    if (!this.isSupabaseConfigured()) {
      throw new Error("Configure Supabase URL and anon key first.");
    }

    initSupabase(this.settings.supabase_url, this.settings.supabase_anon_key);
    await requestEmailOtp(email);
    this.settings.email = email;
    await this.saveSettings();
  }

  async completeEmailCodeSignIn(codeOrUrl: string): Promise<void> {
    if (!this.isSupabaseConfigured()) {
      throw new Error("Configure Supabase URL and anon key first.");
    }

    if (!this.settings.email) {
      throw new Error("Enter the email address first so the plugin can verify the email code.");
    }

    initSupabase(this.settings.supabase_url, this.settings.supabase_anon_key);
    const session = await completeEmailOtp(codeOrUrl, this.settings.email);
    this.settings.email = session.user.email ?? this.settings.email;
    await this.saveSettings();
    await this.syncUserPreferencesFromServer();
    await this.startSync();
    this.updateStatusIndicator();
  }

  async logout(): Promise<void> {
    if (!getSession()) {
      this.statusIndicator?.setDisconnected();
      return;
    }

    await signOut();
    this.syncEngine?.stop();
    this.syncEngine = null;
    this.latestUsageEstimate = null;
    this.latestUserPreferences = null;
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

    const response = await requestUrl({
      url: `${this.settings.supabase_url}/functions/v1/setup-bot`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: this.settings.supabase_anon_key,
      },
      body: JSON.stringify({ bot_token: botToken }),
      throw: false,
    });

    let payload: { error?: string; bot_username?: string; webhook_url?: string } | null = null;
    try {
      payload = response.json as { error?: string; bot_username?: string; webhook_url?: string };
    } catch {
      payload = null;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(payload?.error ?? `Bot setup failed with status ${response.status}.`);
    }

    if (!payload?.bot_username) {
      throw new Error("Bot setup succeeded but the response was incomplete.");
    }

    this.settings.connected_bot_username = payload.bot_username;
    this.settings.connected_bot_webhook_url = payload.webhook_url ?? "";
    await this.saveSettings();

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

  getLatestUsageEstimate(): UsageEstimateRow | null {
    return this.latestUsageEstimate;
  }

  getLatestUserPreferences(): UserPreferencesRow | null {
    return this.latestUserPreferences;
  }

  async refreshUsageEstimate(): Promise<UsageEstimateRow | null> {
    if (!getSession()) {
      this.latestUsageEstimate = null;
      this.updateStatusIndicator();
      return null;
    }

    const response = await getClient().rpc("get_usage_estimate");
    if (response.error) {
      throw new Error(`Failed to load usage estimate: ${response.error.message}`);
    }

    const rows = (response.data ?? []) as UsageEstimateRow[];
    this.latestUsageEstimate = rows[0] ?? null;
    this.updateStatusIndicator();
    return this.latestUsageEstimate;
  }

  async syncUserPreferencesFromServer(): Promise<UserPreferencesRow | null> {
    if (!getSession()) {
      this.latestUserPreferences = null;
      return null;
    }

    const response = await getClient()
      .from("user_preferences")
      .select("*")
      .eq("user_id", getSession()!.user.id)
      .maybeSingle();

    if (response.error) {
      throw new Error(`Failed to load usage settings: ${response.error.message}`);
    }

    const preferences = response.data as UserPreferencesRow | null;
    if (!preferences) {
      return await this.pushUserPreferencesToServer();
    }

    this.latestUserPreferences = preferences;
    this.settings.estimated_storage_limit_mb = Math.max(
      1,
      Math.round(this.latestUserPreferences.estimated_storage_limit_bytes / (1024 * 1024)),
    );
    this.settings.warning_threshold_percent = this.latestUserPreferences.warning_threshold_percent;
    this.settings.telegram_warnings_enabled = this.latestUserPreferences.telegram_warnings_enabled;
    await this.saveSettings();
    return this.latestUserPreferences;
  }

  async pushUserPreferencesToServer(): Promise<UserPreferencesRow | null> {
    const session = getSession();
    if (!session) {
      return null;
    }

    const payload = {
      user_id: session.user.id,
      estimated_storage_limit_bytes: Math.max(
        1,
        Math.round(this.settings.estimated_storage_limit_mb * 1024 * 1024),
      ),
      warning_threshold_percent: Math.min(100, Math.max(1, Math.round(this.settings.warning_threshold_percent))),
      telegram_warnings_enabled: this.settings.telegram_warnings_enabled,
      updated_at: new Date().toISOString(),
    };

    const response = await getClient()
      .from("user_preferences")
      .upsert(payload)
      .select("*")
      .single();

    if (response.error) {
      throw new Error(`Failed to save usage settings: ${response.error.message}`);
    }

    this.latestUserPreferences = response.data as UserPreferencesRow;
    this.settings.estimated_storage_limit_mb = Math.max(
      1,
      Math.round(this.latestUserPreferences.estimated_storage_limit_bytes / (1024 * 1024)),
    );
    this.settings.warning_threshold_percent = this.latestUserPreferences.warning_threshold_percent;
    this.settings.telegram_warnings_enabled = this.latestUserPreferences.telegram_warnings_enabled;
    await this.saveSettings();
    this.updateStatusIndicator();
    return this.latestUserPreferences;
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
      await this.syncUserPreferencesFromServer();
      await this.refreshUsageEstimate();
      await this.startSync();
      this.updateStatusIndicator();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statusIndicator?.setError(message);
      new Notice(`Telegram Bridge initialization failed: ${message}`);
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
      registerInterval: (id) => this.registerInterval(id),
      onMessages: async (messages) => {
        await this.processMessages(messages);
      },
      onError: (error) => {
        this.statusIndicator?.setError(error.message);
        console.error("Telegram Bridge sync failed:", error);
      },
    });

    await this.syncEngine.start();
    await this.refreshUsageEstimate();
    this.updateStatusIndicator();
  }

  private async processMessages(messages: MessageRow[]): Promise<void> {
    this.statusIndicator?.setSyncing();

    for (const message of messages) {
      await this.processMessage(message);
    }

    this.statusIndicator?.setConnected();
    void this.refreshUsageEstimate().catch((error) => {
      console.error("Failed to refresh usage estimate after sync:", error);
    });
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
        const defaultRule = createDefaultDistributionRule();

        return {
          filter_query: candidate.filter_query?.trim() || "{{all}}",
          note_path_template:
            candidate.note_path_template?.trim() || defaultRule.note_path_template,
          file_path_template:
            candidate.file_path_template?.trim() || defaultRule.file_path_template,
          message_template:
            candidate.message_template?.trim() || defaultRule.message_template,
        };
      })
      .filter((rule): rule is PluginSettings["distribution_rules"][number] => rule !== null);

    return normalized.length > 0 ? normalized : [createDefaultDistributionRule()];
  }

  private updateStatusIndicator(): void {
    if (!this.statusIndicator) {
      return;
    }

    if (!this.hasSession()) {
      this.statusIndicator.setDisconnected();
      return;
    }

    const estimate = this.latestUsageEstimate;
    const limitBytes =
      this.latestUserPreferences?.estimated_storage_limit_bytes ??
      Math.round(this.settings.estimated_storage_limit_mb * 1024 * 1024);
    const threshold =
      this.latestUserPreferences?.warning_threshold_percent ?? this.settings.warning_threshold_percent;

    if (!estimate || limitBytes <= 0) {
      this.statusIndicator.setConnected();
      return;
    }

    const usagePercent = Math.round((estimate.estimated_total_bytes / limitBytes) * 100);
    if (usagePercent >= threshold) {
      this.statusIndicator.setWarning(usagePercent);
      return;
    }

    this.statusIndicator.setConnected(usagePercent);
  }
}
