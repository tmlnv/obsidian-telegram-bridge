import { PluginSettingTab, Setting } from "obsidian";
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
      .setName("Poll interval")
      .setDesc("How often the plugin checks for new messages.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.poll_interval_seconds)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            this.plugin.settings.poll_interval_seconds = parsed;
            await this.plugin.saveSettings();
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
        }),
      );

    new Setting(containerEl)
      .setName("Client ID")
      .setDesc("Stable identifier for this plugin installation.")
      .addText((text) => text.setValue(this.plugin.settings.client_id).setDisabled(true));
  }
}
