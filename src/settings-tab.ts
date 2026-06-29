import { Notice, PluginSettingTab, Setting } from "obsidian";
import type ObsidianTelegramPlugin from "./main";
import { createDefaultDistributionRule } from "./types";

export class ObsidianTelegramSettingTab extends PluginSettingTab {
  plugin: ObsidianTelegramPlugin;
  private is_reconfiguring_bot = false;

  constructor(plugin: ObsidianTelegramPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderIntro(containerEl);
    this.renderConnectionHeader(containerEl);
    this.renderUsageCard(containerEl);

    this.renderSupabaseSection(containerEl);
    this.renderAccountSection(containerEl);
    this.renderTelegramBotSection(containerEl);
    this.renderRoutingSection(containerEl);
    this.renderSyncBehaviorSection(containerEl);
    this.renderStorageWarningsSection(containerEl);
    this.renderAdvancedSection(containerEl);
  }

  private renderIntro(containerEl: HTMLElement): void {
    if (this.plugin.isSupabaseConfigured() && this.plugin.hasSession()) {
      return;
    }

    const intro = containerEl.createDiv({ cls: "obsidian-telegram-intro" });
    intro.createDiv({
      cls: "obsidian-telegram-intro-title",
      text: "Requires a self-hosted Supabase project",
    });
    intro.createDiv({
      cls: "obsidian-telegram-intro-body",
      text: "This plugin reads Telegram messages from your own Supabase backend. Follow the README to provision a free Supabase project, deploy the edge functions, and create a Telegram bot before connecting below.",
    });
  }

  private createSection(
    containerEl: HTMLElement,
    title: string,
    options: { is_open?: boolean } = {},
  ): HTMLElement {
    const details = containerEl.createEl("details", {
      cls: "obsidian-telegram-section",
    });
    if (options.is_open) {
      details.setAttr("open", "");
    }
    const summary = details.createEl("summary", {
      cls: "obsidian-telegram-section-summary",
    });
    summary.createSpan({
      cls: "obsidian-telegram-section-title",
      text: title,
    });
    return details.createDiv({ cls: "obsidian-telegram-section-body" });
  }

  private renderSupabaseSection(containerEl: HTMLElement): void {
    const body = this.createSection(containerEl, "Supabase connection", {
      is_open: !this.plugin.isSupabaseConfigured(),
    });

    new Setting(body)
      .setName("Supabase URL")
      .setDesc("Supabase project URL used by the plugin.")
      .addText((text) =>
        text
          .setPlaceholder("https://your-project.supabase.co")
          .setValue(this.plugin.settings.supabase_url)
          .onChange(async (value) => {
            this.plugin.settings.supabase_url = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(body)
      .setName("Supabase anon key")
      .setDesc("Public anon key for the Supabase project.")
      .addTextArea((text) =>
        text
          .setPlaceholder("eyJ...")
          .setValue(this.plugin.settings.supabase_anon_key)
          .onChange(async (value) => {
            this.plugin.settings.supabase_anon_key = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(body)
      .setName("Connection")
      .setDesc("Reconnect the plugin after changing Supabase settings.")
      .addButton((button) =>
        button.setButtonText("Reconnect").onClick(async () => {
          try {
            await this.plugin.reinitializeSupabase();
            new Notice("Supabase client reinitialized.");
            this.display();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        }),
      );
  }

  private renderAccountSection(containerEl: HTMLElement): void {
    const is_signed_in = this.plugin.hasSession();
    const body = this.createSection(containerEl, "Account", {
      is_open: !is_signed_in,
    });

    if (is_signed_in) {
      new Setting(body)
        .setName("Session")
        .setDesc(
          `Signed in as ${this.plugin.getSessionEmail() || this.plugin.settings.email}`,
        )
        .addButton((button) =>
          button.setButtonText("Sign out").onClick(async () => {
            try {
              await this.plugin.logout();
              new Notice("Signed out.");
              this.display();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : String(error));
            }
          }),
        )
        .addButton((button) =>
          button.setButtonText("Sync now").onClick(async () => {
            try {
              await this.plugin.manualSync();
              new Notice("Sync completed.");
            } catch (error) {
              new Notice(error instanceof Error ? error.message : String(error));
            }
          }),
        );
      return;
    }

    let emailValue = this.plugin.settings.email;
    let passwordValue = "";
    let emailCodeValue = "";

    new Setting(body)
      .setName("Email")
      .setDesc("Supabase account email for this plugin.")
      .addText((text) =>
        text
          .setPlaceholder("you@example.com")
          .setValue(emailValue)
          .onChange((value) => {
            emailValue = value.trim();
          }),
      );

    new Setting(body)
      .setName("Password")
      .setDesc("Optional fallback for direct password sign-in.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("Password").onChange((value) => {
          passwordValue = value;
        });
      });

    new Setting(body)
      .setName("Email code")
      .setDesc("Request a passwordless sign-in code by email.")
      .addButton((button) =>
        button.setButtonText("Send email code").setCta().onClick(async () => {
          try {
            await this.plugin.sendEmailCode(emailValue);
            new Notice("Email code sent. Paste the code or email URL below to complete sign-in.");
            this.display();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        }),
      );

    new Setting(body)
      .setName("Email code or URL")
      .setDesc("Paste the OTP code from the email, or paste the full email URL.")
      .addTextArea((text) =>
        text.setPlaceholder("123456 or https://...token=...").onChange((value) => {
          emailCodeValue = value.trim();
        }),
      )
      .addButton((button) =>
        button.setButtonText("Complete email sign-in").onClick(async () => {
          try {
            await this.plugin.completeEmailCodeSignIn(emailCodeValue);
            new Notice("Signed in with email code.");
            this.display();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        }),
      );

    new Setting(body)
      .setName("Password sign-in")
      .setDesc("Sign in with the email and password above.")
      .addButton((button) =>
        button.setButtonText("Sign in").setCta().onClick(async () => {
          try {
            await this.plugin.authenticate(emailValue, passwordValue);
            new Notice("Signed in to Supabase.");
            this.display();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        }),
      );
  }

  private renderTelegramBotSection(containerEl: HTMLElement): void {
    const is_signed_in = this.plugin.hasSession();
    const connected_username = this.plugin.settings.connected_bot_username;
    const show_token_form = !connected_username || this.is_reconfiguring_bot;

    const body = this.createSection(containerEl, "Telegram bot", {
      is_open: is_signed_in && (!connected_username || this.is_reconfiguring_bot),
    });

    new Setting(body)
      .setDesc(
        "Telegram Bot API caps file downloads at 20 MB. Larger files (big videos, documents) are recorded as message metadata only — the file bytes are not pulled into Supabase storage or your vault.",
      )
      .setClass("obsidian-telegram-section-note");

    if (!is_signed_in) {
      new Setting(body)
        .setDesc("Sign in from the Account section first to connect a Telegram bot.")
        .setClass("obsidian-telegram-section-note");
      return;
    }

    if (connected_username && !this.is_reconfiguring_bot) {
      new Setting(body)
        .setName("Connected bot")
        .setDesc(`Connected as @${connected_username}.`)
        .addButton((button) =>
          button.setButtonText("Reconfigure bot").onClick(() => {
            this.is_reconfiguring_bot = true;
            this.display();
          }),
        );
      return;
    }

    let botTokenValue = "";

    new Setting(body)
      .setName("Bot token")
      .setDesc("Token from BotFather. Sent to the setup function and not stored in plugin settings.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("123456:ABC-DEF...").onChange((value) => {
          botTokenValue = value.trim();
        });
      })
      .addButton((button) =>
        button.setButtonText("Setup bot").setCta().onClick(async () => {
          try {
            const result = await this.plugin.setupBot(botTokenValue);
            const webhookSuffix = result.webhook_url ? ` Webhook: ${result.webhook_url}` : "";
            new Notice(`Connected @${result.bot_username}.${webhookSuffix}`);
            this.is_reconfiguring_bot = false;
            this.display();
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        }),
      );

    if (show_token_form && connected_username) {
      new Setting(body)
        .setName("Cancel reconfigure")
        .setDesc(`Keep the existing connection to @${connected_username}.`)
        .addButton((button) =>
          button.setButtonText("Cancel").onClick(() => {
            this.is_reconfiguring_bot = false;
            this.display();
          }),
        );
    }
  }

  private renderRoutingSection(containerEl: HTMLElement): void {
    const body = this.createSection(containerEl, "Routing", { is_open: false });

    new Setting(body)
      .setName("Default note folder")
      .setDesc("Base folder used when writing synced Telegram messages.")
      .addText((text) =>
        text
          .setPlaceholder("Telegram")
          .setValue(this.plugin.settings.default_note_folder)
          .onChange(async (value) => {
            this.plugin.settings.default_note_folder = value.trim() || "Telegram";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(body)
      .setName("Routing rules")
      .setDesc("Rules are checked top to bottom. Keep a final {{all}} fallback rule.")
      .setHeading();

    this.plugin.settings.distribution_rules.forEach((rule, index) => {
      const isFallbackRule = rule.filter_query.trim() === "{{all}}";
      new Setting(body)
        .setName(isFallbackRule ? `Rule ${index + 1} (fallback)` : `Rule ${index + 1}`)
        .setHeading();

      new Setting(body)
        .setName("Filter query")
        .setDesc("Examples: {{topic=Roadmap}}, {{chat=Ideas}}, {{all}}")
        .addText((text) =>
          text
            .setPlaceholder("{{all}}")
            .setValue(rule.filter_query)
            .onChange(async (value) => {
              this.plugin.settings.distribution_rules[index].filter_query = value.trim() || "{{all}}";
              this.syncDefaultRule(index);
              await this.plugin.saveSettings();
            }),
        );

      new Setting(body)
        .setName("Note path template")
        .setDesc("Path template used when this rule matches.")
        .addText((text) =>
          text
            .setPlaceholder("Telegram/{{chat}}/{{topic}}{{messageDate:YYYY-MM-DD HH-mm-ss}}-{{messageId}}.md")
            .setValue(rule.note_path_template)
            .onChange(async (value) => {
              this.plugin.settings.distribution_rules[index].note_path_template =
                value.trim() || createDefaultDistributionRule().note_path_template;
              this.syncDefaultRule(index);
              await this.plugin.saveSettings();
            }),
        );

      new Setting(body)
        .setName("File path template")
        .setDesc("Path template used for synced files when this rule matches.")
        .addText((text) =>
          text
            .setPlaceholder("Telegram/files/{{chat}}/{{file:name}}.{{file:extension}}")
            .setValue(rule.file_path_template)
            .onChange(async (value) => {
              this.plugin.settings.distribution_rules[index].file_path_template =
                value.trim() || createDefaultDistributionRule().file_path_template;
              this.syncDefaultRule(index);
              await this.plugin.saveSettings();
            }),
        );

      new Setting(body)
        .setName("Message template")
        .setDesc("Template used to render the note block for this rule.")
        .addTextArea((text) =>
          text
            .setPlaceholder("- {{messageDate:YYYY-MM-DD HH:mm:ss}} {{user}}")
            .setValue(rule.message_template)
            .onChange(async (value) => {
              this.plugin.settings.distribution_rules[index].message_template =
                value.trim() || createDefaultDistributionRule().message_template;
              this.syncDefaultRule(index);
              await this.plugin.saveSettings();
            }),
        )
        .addButton((button) =>
          button
            .setButtonText("Remove")
            .setWarning()
            .setDisabled(this.plugin.settings.distribution_rules.length === 1)
            .onClick(async () => {
              this.plugin.settings.distribution_rules.splice(index, 1);
              this.ensureFallbackRule();
              this.syncDefaultRule(0);
              await this.plugin.saveSettings();
              this.display();
            }),
        );
    });

    new Setting(body)
      .setName("Rules")
      .setDesc("Add a new routing rule above the fallback rule.")
      .addButton((button) =>
        button.setButtonText("Add rule").setCta().onClick(async () => {
          const fallbackIndex = this.plugin.settings.distribution_rules.findIndex(
            (rule) => rule.filter_query.trim() === "{{all}}",
          );
          const insertIndex =
            fallbackIndex === -1 ? this.plugin.settings.distribution_rules.length : fallbackIndex;
          this.plugin.settings.distribution_rules.splice(insertIndex, 0, createDefaultDistributionRule());
          this.plugin.settings.distribution_rules[insertIndex].filter_query = "{{topic=Example}}";
          await this.plugin.saveSettings();
          this.display();
        }),
      );
  }

  private renderSyncBehaviorSection(containerEl: HTMLElement): void {
    const body = this.createSection(containerEl, "Sync behavior", { is_open: false });

    new Setting(body)
      .setName("Poll interval")
      .setDesc("How often the plugin checks for new messages.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.poll_interval_seconds)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            this.plugin.settings.poll_interval_seconds = parsed;
            await this.plugin.saveSettings();
            if (this.plugin.hasSession()) {
              await this.plugin.reinitializeSupabase();
            }
          }
        }),
      );

    new Setting(body)
      .setName("Realtime")
      .setDesc("Use Supabase Realtime to trigger early polls.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.is_realtime_enabled).onChange(async (value) => {
          this.plugin.settings.is_realtime_enabled = value;
          await this.plugin.saveSettings();
          if (this.plugin.hasSession()) {
            await this.plugin.reinitializeSupabase();
          }
        }),
      );
  }

  private renderStorageWarningsSection(containerEl: HTMLElement): void {
    const body = this.createSection(containerEl, "Storage warnings", { is_open: false });

    new Setting(body)
      .setName("Estimated storage limit (MB)")
      .setDesc("Soft limit used for local estimates and warnings. Default is 1024 MB.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.estimated_storage_limit_mb)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            return;
          }

          this.plugin.settings.estimated_storage_limit_mb = parsed;
          await this.plugin.saveSettings();
          if (this.plugin.hasSession()) {
            await this.plugin.pushUserPreferencesToServer();
            await this.refreshUsageCard();
          }
        }),
      );

    new Setting(body)
      .setName("Warning threshold (%)")
      .setDesc("Send a warning once the estimated usage reaches this percentage of the soft limit.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.warning_threshold_percent)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
            return;
          }

          this.plugin.settings.warning_threshold_percent = parsed;
          await this.plugin.saveSettings();
          if (this.plugin.hasSession()) {
            await this.plugin.pushUserPreferencesToServer();
            await this.refreshUsageCard();
          }
        }),
      );

    new Setting(body)
      .setName("Telegram warnings")
      .setDesc("Send a warning through the connected Telegram bot when the threshold is crossed.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.telegram_warnings_enabled).onChange(async (value) => {
          this.plugin.settings.telegram_warnings_enabled = value;
          await this.plugin.saveSettings();
          if (this.plugin.hasSession()) {
            await this.plugin.pushUserPreferencesToServer();
            await this.refreshUsageCard();
          }
        }),
      );

    new Setting(body)
      .setName("Usage status")
      .setDesc("Refresh the estimate and current warning state.")
      .addButton((button) =>
        button.setButtonText("Refresh usage").onClick(async () => {
          try {
            await this.refreshUsageCard();
            new Notice("Usage estimate refreshed.");
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        }),
      );
  }

  private renderAdvancedSection(containerEl: HTMLElement): void {
    const body = this.createSection(containerEl, "Advanced", { is_open: false });

    new Setting(body)
      .setName("Client ID")
      .setDesc("Stable identifier for this plugin installation.")
      .addText((text) => text.setValue(this.plugin.settings.client_id).setDisabled(true));
  }

  private syncDefaultRule(index: number): void {
    if (index !== 0) {
      return;
    }

    const rule = this.plugin.settings.distribution_rules[0];
    this.plugin.settings.default_note_path_template = rule.note_path_template;
    this.plugin.settings.default_file_path_template = rule.file_path_template;
    this.plugin.settings.default_message_template = rule.message_template;
  }

  private ensureFallbackRule(): void {
    const hasFallback = this.plugin.settings.distribution_rules.some(
      (rule) => rule.filter_query.trim() === "{{all}}",
    );

    if (!hasFallback) {
      this.plugin.settings.distribution_rules.push(createDefaultDistributionRule());
    }
  }

  private renderConnectionHeader(containerEl: HTMLElement): void {
    const header = containerEl.createDiv({ cls: "obsidian-telegram-settings-header" });
    const projectHost = this.plugin.settings.supabase_url
      ? (() => {
          try {
            return new URL(this.plugin.settings.supabase_url).host;
          } catch {
            return this.plugin.settings.supabase_url;
          }
        })()
      : "Not configured";

    this.createConnectionRow(header, "Supabase", this.plugin.isSupabaseConfigured() ? "Configured" : "Missing", projectHost);
    this.createConnectionRow(
      header,
      "Auth",
      this.plugin.hasSession() ? "Connected" : "Signed out",
      this.plugin.getSessionEmail() || this.plugin.settings.email || "No user session",
    );
    this.createConnectionRow(
      header,
      "Telegram Bot",
      this.plugin.settings.connected_bot_username ? "Connected" : "Not connected",
      this.plugin.settings.connected_bot_username
        ? `@${this.plugin.settings.connected_bot_username}`
        : "Run Setup bot after sign-in",
    );
  }

  private createConnectionRow(
    containerEl: HTMLElement,
    label: string,
    value: string,
    description: string,
  ): void {
    const row = containerEl.createDiv({ cls: "obsidian-telegram-connection-row" });
    row.createDiv({ cls: "obsidian-telegram-connection-label", text: label });

    const body = row.createDiv({ cls: "obsidian-telegram-connection-body" });
    body.createDiv({ cls: "obsidian-telegram-connection-value", text: value });
    body.createDiv({ cls: "obsidian-telegram-connection-description", text: description });
  }

  private usageSummaryEl: HTMLElement | null = null;

  private renderUsageCard(containerEl: HTMLElement): void {
    const sectionEl = containerEl.createDiv({ cls: "obsidian-telegram-usage-section" });
    new Setting(sectionEl).setName("Storage usage").setHeading();

    const summaryEl = sectionEl.createDiv({ cls: "obsidian-telegram-usage-card" });
    this.usageSummaryEl = summaryEl;

    if (this.plugin.hasSession()) {
      this.renderUsageSkeleton(summaryEl);
      void this.populateUsageSection(summaryEl).catch((error) => {
        summaryEl.empty();
        summaryEl.setText(error instanceof Error ? error.message : String(error));
      });
    } else {
      summaryEl.setText("Sign in to load estimated storage usage and warning settings.");
    }
  }

  private renderUsageSkeleton(summaryEl: HTMLElement): void {
    summaryEl.empty();
    summaryEl.addClass("is-loading");

    const headerEl = summaryEl.createDiv({ cls: "obsidian-telegram-usage-header" });
    const headerCopyEl = headerEl.createDiv();
    headerCopyEl.createDiv({ cls: "obsidian-telegram-usage-eyebrow", text: "Estimated usage" });
    headerCopyEl.createDiv({
      cls: "obsidian-telegram-usage-title obsidian-telegram-skeleton-text",
      text: "—",
    });
    headerCopyEl.createDiv({
      cls: "obsidian-telegram-usage-subtitle obsidian-telegram-skeleton-text",
      text: "Loading estimated storage usage…",
    });
    headerEl.createDiv({
      cls: "obsidian-telegram-usage-badge obsidian-telegram-skeleton-badge",
      text: "—",
    });

    const chartEl = summaryEl.createDiv({ cls: "obsidian-telegram-usage-chart" });
    const scaleEl = chartEl.createDiv({ cls: "obsidian-telegram-usage-scale" });
    scaleEl.createSpan({ text: "0%" });
    scaleEl.createSpan({ text: "100%" });
    const trackEl = chartEl.createDiv({ cls: "obsidian-telegram-usage-track" });
    trackEl.createDiv({ cls: "obsidian-telegram-usage-fill obsidian-telegram-skeleton-fill" });
    chartEl.createDiv({
      cls: "obsidian-telegram-usage-threshold-label obsidian-telegram-skeleton-text",
      text: "Warning threshold —",
    });

    const statsEl = summaryEl.createDiv({ cls: "obsidian-telegram-usage-stats" });
    this.createUsageStat(statsEl, "Messages", "—");
    this.createUsageStat(statsEl, "Files", "—");
    this.createUsageStat(statsEl, "Database", "—", "— of estimate");
    this.createUsageStat(statsEl, "Files", "—", "— of estimate");

    const footerEl = summaryEl.createDiv({ cls: "obsidian-telegram-usage-footer" });
    footerEl.createDiv({
      cls: "obsidian-telegram-usage-note obsidian-telegram-skeleton-text",
      text: "Fetching notification status…",
    });
    footerEl.createDiv({
      cls: "obsidian-telegram-usage-note obsidian-telegram-skeleton-text",
      text: "Fetching warning state…",
    });
  }

  private async refreshUsageCard(): Promise<void> {
    if (!this.usageSummaryEl) {
      return;
    }
    await this.populateUsageSection(this.usageSummaryEl);
  }

  private async populateUsageSection(summaryEl: HTMLElement): Promise<void> {
    if (!this.plugin.hasSession()) {
      summaryEl.setText("Sign in to load estimated storage usage and warning settings.");
      return;
    }

    const [preferences, usage] = await Promise.all([
      this.plugin.syncUserPreferencesFromServer(),
      this.plugin.refreshUsageEstimate(),
    ]);

    const limitBytes =
      preferences?.estimated_storage_limit_bytes ??
      this.plugin.settings.estimated_storage_limit_mb * 1024 * 1024;
    const usageBytes = usage?.estimated_total_bytes ?? 0;
    const usagePercent = limitBytes > 0 ? Math.round((usageBytes / limitBytes) * 100) : 0;
    const notificationStatus = preferences?.notification_chat_id
      ? `Alerts will be sent to private chat ${preferences.notification_chat_id}.`
      : "No private bot chat registered yet. Send your bot a direct message to enable Telegram alerts.";
    const thresholdPercent =
      preferences?.warning_threshold_percent ?? this.plugin.settings.warning_threshold_percent;
    const databasePercent = usageBytes > 0 && usage ? Math.round((usage.estimated_database_bytes / usageBytes) * 100) : 0;
    const filesPercent = usageBytes > 0 && usage ? Math.round((usage.estimated_file_bytes / usageBytes) * 100) : 0;

    summaryEl.empty();
    summaryEl.removeClass("is-loading");

    const headerEl = summaryEl.createDiv({ cls: "obsidian-telegram-usage-header" });
    const headerCopyEl = headerEl.createDiv();
    headerCopyEl.createDiv({ cls: "obsidian-telegram-usage-eyebrow", text: "Estimated usage" });
    headerCopyEl.createDiv({
      cls: "obsidian-telegram-usage-title",
      text:
        usage === null
          ? "No synced data yet"
          : `${this.formatBytes(usageBytes)} of ${this.formatBytes(limitBytes)}`,
    });
    headerCopyEl.createDiv({
      cls: "obsidian-telegram-usage-subtitle",
      text:
        usage === null
          ? "The chart will appear after your first synced messages."
          : `${usage.message_count} messages and ${usage.file_count} files tracked by the estimate.`,
    });
    headerEl.createDiv({
      cls: "obsidian-telegram-usage-badge",
      text: `${usagePercent}%`,
    });

    const chartEl = summaryEl.createDiv({ cls: "obsidian-telegram-usage-chart" });
    const scaleEl = chartEl.createDiv({ cls: "obsidian-telegram-usage-scale" });
    scaleEl.createSpan({ text: "0%" });
    scaleEl.createSpan({ text: "100%" });

    const clampedUsagePercent = Math.min(100, Math.max(0, usagePercent));
    const clampedThresholdPercent = Math.min(100, Math.max(0, thresholdPercent));

    const trackEl = chartEl.createDiv({ cls: "obsidian-telegram-usage-track" });
    const fillEl = trackEl.createDiv({ cls: "obsidian-telegram-usage-fill" });
    fillEl.style.setProperty("--telegram-bridge-usage-percent", `${clampedUsagePercent}%`);

    const thresholdEl = trackEl.createDiv({ cls: "obsidian-telegram-usage-threshold" });
    thresholdEl.style.setProperty("--telegram-bridge-threshold-percent", `${clampedThresholdPercent}%`);
    thresholdEl.setAttribute("aria-label", `Warning threshold ${thresholdPercent}%`);

    const thresholdLabelEl = chartEl.createDiv({ cls: "obsidian-telegram-usage-threshold-label" });
    thresholdLabelEl.setText(`Warning threshold ${thresholdPercent}%`);

    const statsEl = summaryEl.createDiv({ cls: "obsidian-telegram-usage-stats" });
    this.createUsageStat(statsEl, "Messages", usage ? String(usage.message_count) : "0");
    this.createUsageStat(statsEl, "Files", usage ? String(usage.file_count) : "0");
    this.createUsageStat(
      statsEl,
      "Database",
      usage ? this.formatBytes(usage.estimated_database_bytes) : "0 B",
      usage ? `${databasePercent}% of estimate` : undefined,
    );
    this.createUsageStat(
      statsEl,
      "Files",
      usage ? this.formatBytes(usage.estimated_file_bytes) : "0 B",
      usage ? `${filesPercent}% of estimate` : undefined,
    );

    const footerEl = summaryEl.createDiv({ cls: "obsidian-telegram-usage-footer" });
    footerEl.createDiv({
      cls: "obsidian-telegram-usage-note",
      text: notificationStatus,
    });
    footerEl.createDiv({
      cls: "obsidian-telegram-usage-note",
      text: preferences?.telegram_warnings_enabled
        ? "Telegram warnings are enabled."
        : "Telegram warnings are disabled.",
    });
  }

  private createUsageStat(containerEl: HTMLElement, label: string, value: string, meta?: string): void {
    const statEl = containerEl.createDiv({ cls: "obsidian-telegram-usage-stat" });
    statEl.createDiv({ cls: "obsidian-telegram-usage-stat-label", text: label });
    statEl.createDiv({ cls: "obsidian-telegram-usage-stat-value", text: value });
    if (meta) {
      statEl.createDiv({ cls: "obsidian-telegram-usage-stat-meta", text: meta });
    }
  }

  private formatBytes(bytes: number): string {
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
}
