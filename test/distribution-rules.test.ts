import { describe, expect, it } from "vitest";
import { findMatchingRule, matchRule, parseFilterQuery } from "../src/distribution-rules";
import type { DistributionRule, MessageRow } from "../src/types";

function createMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 1,
    user_id: "user-1",
    telegram_update_id: 10,
    telegram_message_id: 100,
    telegram_chat_id: -100123,
    telegram_chat_title: "Ideas",
    telegram_date: "2026-03-03T10:00:00.000Z",
    topic_id: 42,
    topic_name: "Roadmap",
    sender_name: "Alice",
    sender_username: "alice",
    sender_id: 1,
    message_type: "text",
    text_content: "hello roadmap",
    caption: null,
    entities: null,
    caption_entities: null,
    forward_from_name: null,
    forward_date: null,
    reply_to_message_id: null,
    media_group_id: null,
    file_path: null,
    file_name: null,
    file_size: null,
    file_mime_type: null,
    is_edit: false,
    edit_date: null,
    content_hash: null,
    raw_update: {},
    created_at: "2026-03-03T10:00:00.000Z",
    updated_at: "2026-03-03T10:00:00.000Z",
    ...overrides,
  };
}

describe("parseFilterQuery", () => {
  it("parses all rule", () => {
    expect(parseFilterQuery("{{all}}")).toEqual([{ type: "all", operation: "=", value: "" }]);
  });

  it("parses multiple conditions", () => {
    expect(parseFilterQuery("{{chat=Ideas}}{{topic=Roadmap}}")).toEqual([
      { type: "chat", operation: "=", value: "Ideas" },
      { type: "topic", operation: "=", value: "Roadmap" },
    ]);
  });
});

describe("matchRule", () => {
  const rule: DistributionRule = {
    filter_query: "{{topic=Roadmap}}",
    note_path_template: "Telegram/{{chat}}/{{topic}}Messages.md",
    file_path_template: "Telegram/files/{{chat}}/{{file:name}}.{{file:extension}}",
    message_template: "{{content}}",
  };

  it("matches topic rules", () => {
    expect(matchRule(createMessage(), rule)).toBe(true);
  });

  it("rejects mismatched topic rules", () => {
    expect(matchRule(createMessage({ topic_name: "Inbox" }), rule)).toBe(false);
  });
});

describe("findMatchingRule", () => {
  it("returns first matching rule", () => {
    const rules: DistributionRule[] = [
      {
        filter_query: "{{topic=Roadmap}}",
        note_path_template: "Telegram/{{chat}}/{{topic}}Messages.md",
        file_path_template: "Telegram/files/{{chat}}/{{file:name}}.{{file:extension}}",
        message_template: "{{content}}",
      },
      {
        filter_query: "{{all}}",
        note_path_template: "Telegram/Fallback.md",
        file_path_template: "Telegram/files/Fallback/{{file:name}}.{{file:extension}}",
        message_template: "{{content}}",
      },
    ];

    expect(findMatchingRule(createMessage(), rules)).toEqual(rules[0]);
  });
});
