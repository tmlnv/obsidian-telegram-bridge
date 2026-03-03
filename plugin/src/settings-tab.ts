import { Notice, PluginSettingTab, Setting } from "obsidian";
import type ObsidianTelegramPlugin from "./main";
import { createDefaultDistributionRule } from "./types";

export class ObsidianTelegramSettingTab extends PluginSettingTab {
  plugin: ObsidianTelegramPlugin;

  constructor(plugin: ObsidianTelegramPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    let emailValue = this.plugin.settings.email;
    let passwordValue = "";
    let emailCodeValue = "";
    let botTokenValue = "";

    containerEl.createEl("h2", { text: "Obsidian Telegram" });

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    containerEl.createEl("h3", { text: "Routing Rules" });
    containerEl.createEl("p", {
      text: "Rules are checked top to bottom. Keep a final {{all}} fallback rule.",
    });

    this.plugin.settings.distribution_rules.forEach((rule, index) => {
      const isFallbackRule = rule.filter_query.trim() === "{{all}}";
      const ruleHeader = containerEl.createDiv({ cls: "obsidian-telegram-rule" });
      ruleHeader.createEl("h4", {
        text: isFallbackRule ? `Rule ${index + 1} (fallback)` : `Rule ${index + 1}`,
      });

      new Setting(containerEl)
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

      new Setting(containerEl)
        .setName("Note path template")
        .setDesc("Path template used when this rule matches.")
        .addText((text) =>
          text
            .setPlaceholder("Telegram/{{chat}}/{{topic}}Messages.md")
            .setValue(rule.note_path_template)
            .onChange(async (value) => {
              this.plugin.settings.distribution_rules[index].note_path_template =
                value.trim() || createDefaultDistributionRule().note_path_template;
              this.syncDefaultRule(index);
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
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

      new Setting(containerEl)
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

    new Setting(containerEl)
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

    containerEl.createEl("h3", { text: "Authentication" });

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Password")
      .setDesc("Optional fallback for direct password sign-in.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("Password").onChange((value) => {
          passwordValue = value;
        });
      });

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("Session")
      .setDesc(
        this.plugin.hasSession()
          ? `Signed in as ${this.plugin.getSessionEmail() || this.plugin.settings.email}`
          : "No active Supabase session.",
      )
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

    if (this.plugin.hasSession()) {
      containerEl.createEl("h3", { text: "Telegram Bot" });

      new Setting(containerEl)
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
            } catch (error) {
              new Notice(error instanceof Error ? error.message : String(error));
            }
          }),
        );
    }

    new Setting(containerEl)
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

    new Setting(containerEl)
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

    new Setting(containerEl)
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
}
