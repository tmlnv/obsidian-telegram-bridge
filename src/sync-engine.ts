import { Platform } from "obsidian";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { MessageRow, SyncClientRow, SyncCursor } from "./types";
import { getClient, getSession } from "./supabase-client";

export interface SyncEngineOptions {
  clientId: string;
  clientName: string;
  pluginVersion: string;
  vaultFingerprint: string;
  pollIntervalSeconds: number;
  isRealtimeEnabled: boolean;
  registerInterval: (id: number) => number;
  onMessages: (messages: MessageRow[]) => Promise<void>;
  onError: (error: Error) => void;
}

export class SyncEngine {
  private readonly clientId: string;
  private readonly clientName: string;
  private readonly pluginVersion: string;
  private readonly vaultFingerprint: string;
  private readonly onMessages: (messages: MessageRow[]) => Promise<void>;
  private readonly onError: (error: Error) => void;
  private readonly pollIntervalSeconds: number;
  private readonly isRealtimeEnabled: boolean;
  private readonly registerInterval: (id: number) => number;
  private pollIntervalId: number | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private isPolling = false;
  private cursor: SyncCursor = {
    last_processed_message_updated_at: null,
    last_processed_message_id: null,
  };

  constructor(options: SyncEngineOptions) {
    this.clientId = options.clientId;
    this.clientName = options.clientName;
    this.pluginVersion = options.pluginVersion;
    this.vaultFingerprint = options.vaultFingerprint;
    this.pollIntervalSeconds = options.pollIntervalSeconds;
    this.isRealtimeEnabled = options.isRealtimeEnabled;
    this.registerInterval = options.registerInterval;
    this.onMessages = options.onMessages;
    this.onError = options.onError;
  }

  async start(): Promise<void> {
    await this.ensureSyncClient();
    await this.poll();

    this.stopPolling();
    this.pollIntervalId = this.registerInterval(
      window.setInterval(() => {
        void this.poll();
      }, this.pollIntervalSeconds * 1000),
    );

    if (this.isRealtimeEnabled) {
      this.subscribeRealtime();
    }
  }

  stop(): void {
    this.stopPolling();
    this.unsubscribeRealtime();
  }

  private stopPolling(): void {
    if (this.pollIntervalId !== null) {
      window.clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  async poll(): Promise<void> {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;

    try {
      const messages = await this.fetchMessagesAfterCursor();
      if (messages.length === 0) {
        await this.touchSyncClient();
        return;
      }

      await this.onMessages(messages);
      const lastMessage = messages[messages.length - 1];
      this.cursor = {
        last_processed_message_updated_at: lastMessage.updated_at,
        last_processed_message_id: lastMessage.id,
      };
      await this.updateCursor();
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.isPolling = false;
    }
  }

  private async ensureSyncClient(): Promise<void> {
    const session = getSession();
    if (!session) {
      throw new Error("Cannot start sync without an authenticated session.");
    }

    const response = await getClient()
      .from("sync_clients")
      .select("*")
      .eq("id", this.clientId)
      .maybeSingle();

    if (response.error) {
      throw new Error(`Failed to load sync client: ${response.error.message}`);
    }

    const row = response.data as SyncClientRow | null;
    if (row) {
      this.cursor = {
        last_processed_message_updated_at: row.last_processed_message_updated_at,
        last_processed_message_id: row.last_processed_message_id,
      };
      return;
    }

    const payload = this.buildSyncClientPayload(session.user.id, this.cursor);
    const { error: upsertError } = await getClient().from("sync_clients").upsert(payload);

    if (upsertError) {
      throw new Error(`Failed to create sync client: ${upsertError.message}`);
    }
  }

  private buildSyncClientPayload(userId: string, cursor: SyncCursor) {
    return {
      id: this.clientId,
      user_id: userId,
      client_name: this.clientName,
      vault_fingerprint: this.vaultFingerprint,
      platform: Platform.isDesktopApp ? "desktop" : "mobile",
      plugin_version: this.pluginVersion,
      last_processed_message_updated_at: cursor.last_processed_message_updated_at,
      last_processed_message_id: cursor.last_processed_message_id,
      last_sync_at: new Date().toISOString(),
    };
  }

  private async touchSyncClient(): Promise<void> {
    const session = getSession();
    if (!session) {
      return;
    }

    const payload = this.buildSyncClientPayload(session.user.id, this.cursor);
    const { error } = await getClient().from("sync_clients").upsert(payload);

    if (error) {
      throw new Error(`Failed to update sync timestamp: ${error.message}`);
    }
  }

  private async updateCursor(): Promise<void> {
    const session = getSession();
    if (!session) {
      throw new Error("Session disappeared while updating cursor.");
    }

    const payload = this.buildSyncClientPayload(session.user.id, this.cursor);
    const { error } = await getClient().from("sync_clients").upsert(payload);

    if (error) {
      throw new Error(`Failed to persist sync cursor: ${error.message}`);
    }
  }

  private async fetchMessagesAfterCursor(): Promise<MessageRow[]> {
    const response = await getClient().rpc("fetch_messages_after_cursor", {
      p_last_processed_message_updated_at: this.cursor.last_processed_message_updated_at,
      p_last_processed_message_id: this.cursor.last_processed_message_id,
      p_limit: 50,
    });

    if (response.error) {
      throw new Error(`Failed to fetch messages: ${response.error.message}`);
    }

    return (response.data ?? []) as MessageRow[];
  }

  private subscribeRealtime(): void {
    this.unsubscribeRealtime();

    const session = getSession();
    if (!session) {
      return;
    }

    this.realtimeChannel = getClient()
      .channel(`messages-${this.clientId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          void this.poll();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `user_id=eq.${session.user.id}`,
        },
        () => {
          void this.poll();
        },
      )
      .subscribe();
  }

  private unsubscribeRealtime(): void {
    if (!this.realtimeChannel) {
      return;
    }

    void getClient().removeChannel(this.realtimeChannel);
    this.realtimeChannel = null;
  }

  async downloadFile(storagePath: string): Promise<ArrayBuffer> {
    const { data, error } = await getClient().storage.from("telegram-files").download(storagePath);

    if (error || !data) {
      throw new Error(`Failed to download file from storage: ${error?.message ?? storagePath}`);
    }

    return await data.arrayBuffer();
  }
}
