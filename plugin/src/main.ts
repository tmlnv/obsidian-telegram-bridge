import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type PluginSettings } from "./types";
import { ObsidianTelegramSettingTab } from "./settings-tab";
import { StatusIndicator } from "./status-indicator";

function createClientId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `client-${Date.now()}`;
}

export default class ObsidianTelegramPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private statusIndicator: StatusIndicator | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    if (!this.settings.client_id) {
      this.settings.client_id = createClientId();
      await this.saveSettings();
    }

    this.statusIndicator = new StatusIndicator(this);
    this.statusIndicator.setIdle();

    this.addSettingTab(new ObsidianTelegramSettingTab(this));

    this.addCommand({
      id: "show-client-id",
      name: "Show Obsidian Telegram client ID",
      callback: () => {
        this.statusIndicator?.setConnected();
        console.log("Obsidian Telegram client_id:", this.settings.client_id);
      },
    });
  }

  onunload(): void {
    this.statusIndicator?.destroy();
    this.statusIndicator = null;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
