import { describe, expect, it } from "vitest";
import { expandTemplate } from "../src/template-engine";
import type { MessageRow } from "../src/types";

function createMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 1,
    user_id: "user-1",
    telegram_update_id: 10,
    telegram_message_id: 100,
    telegram_chat_id: -100123,
    telegram_chat_title: "Ideas Board",
    telegram_date: "2026-03-03T10:11:12.000Z",
    topic_id: 42,
    topic_name: "Roadmap",
    sender_name: "Alice Smith",
    sender_username: "alice",
    sender_id: 1,
    message_type: "text",
    text_content: "hello roadmap world",
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
    created_at: "2026-03-03T10:11:12.000Z",
    updated_at: "2026-03-03T10:11:12.000Z",
    ...overrides,
  };
}

describe("expandTemplate", () => {
  it("expands message fields", () => {
    expect(expandTemplate("{{chat}}/{{topic}}{{messageId}}", createMessage())).toBe(
      "Ideas Board/Roadmap/100",
    );
  });

  it("formats dates", () => {
    expect(expandTemplate("{{messageDate:YYYY-MM-DD HH:mm:ss}}", createMessage())).toBe(
      "2026-03-03 10:11:12",
    );
  });

  it("sanitizes paths", () => {
    expect(
      expandTemplate("Telegram/{{chat}}/{{topic}}Messages.md", createMessage(), { isPath: true }),
    ).toBe("Telegram/Ideas Board/Roadmap/Messages.md");
  });

  it("supports content slicing", () => {
    expect(expandTemplate("{{content:5}}", createMessage())).toBe("hello");
  });

  it("strips path separators from variable values in path mode", () => {
    expect(
      expandTemplate(
        "Telegram/{{chat}}/{{content:30}}.md",
        createMessage({
          telegram_chat_title: "Saved",
          topic_id: null,
          topic_name: null,
          text_content: "https://radio.garden/something",
        }),
        { isPath: true },
      ),
    ).toBe("Telegram/Saved/https___radio.garden_something.md");
  });

  it("preserves path separators in non-path mode", () => {
    expect(
      expandTemplate(
        "see {{content}}",
        createMessage({ text_content: "https://radio.garden/x" }),
      ),
    ).toBe("see https://radio.garden/x");
  });
});
