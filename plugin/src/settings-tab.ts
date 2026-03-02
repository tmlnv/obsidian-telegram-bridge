import { Notice, PluginSettingTab, Setting } from "obsidian";
import type ObsidianTelegramPlugin from "./main";

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
      .setDesc("Used only for sign-in. The plugin relies on the Supabase session after that.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("Password").onChange((value) => {
          passwordValue = value;
        });
      });

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
}
