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

  setConnected(usagePercent?: number): void {
    if (typeof usagePercent === "number") {
      this.el.setText(`Telegram: connected (${usagePercent}% used est.)`);
      return;
    }

    this.el.setText("Telegram: connected");
  }

  setDisconnected(): void {
    this.el.setText("Telegram: disconnected");
  }

  setSyncing(): void {
    this.el.setText("Telegram: syncing");
  }

  setWarning(usagePercent: number): void {
    this.el.setText(`Telegram: warning (${usagePercent}% used est.)`);
  }

  setError(message: string): void {
    this.el.setText(`Telegram: error - ${message}`);
  }

  destroy(): void {
    this.el.remove();
  }
}
