import type { Plugin } from "obsidian";

export class StatusIndicator {
  private readonly el;

  constructor(plugin: Plugin) {
    this.el = plugin.addStatusBarItem();
    this.el.addClass("obsidian-telegram-status");
    this.setIdle();
  }

  setIdle(): void {
    this.el.setText("Telegram: idle");
  }

  setConnected(): void {
    this.el.setText("Telegram: connected");
  }

  setSyncing(): void {
    this.el.setText("Telegram: syncing");
  }

  setError(message: string): void {
    this.el.setText(`Telegram: error - ${message}`);
  }

  destroy(): void {
    this.el.remove();
  }
}
