import type { ConditionType, DistributionRule, FilterCondition, FilterOperation, MessageRow } from "./types";

const FILTER_REGEX = /\{\{([^{}=!~]+?)(=|!=|~|!~)([^{}]+)\}\}/g;

function parseAllRule(query: string): FilterCondition[] {
  if (query.trim() === "{{all}}") {
    return [{ type: "all", operation: "=", value: "" }];
  }

  return [];
}

export function parseFilterQuery(query: string): FilterCondition[] {
  if (!query.trim()) {
    return [];
  }

  const allRule = parseAllRule(query);
  if (allRule.length > 0) {
    return allRule;
  }

  const conditions: FilterCondition[] = [];
  let match: RegExpExecArray | null;
  FILTER_REGEX.lastIndex = 0;

  while ((match = FILTER_REGEX.exec(query)) !== null) {
    const type = match[1] as ConditionType;
    const operation = match[2] as FilterOperation;
    const value = match[3].trim();

    if (["chat", "topic", "user", "content"].includes(type)) {
      conditions.push({ type, operation, value });
    }
  }

  return conditions;
}

function getFieldValue(message: MessageRow, type: ConditionType): string {
  switch (type) {
    case "chat":
      return message.telegram_chat_title ?? String(message.telegram_chat_id);
    case "topic":
      return message.topic_name ?? (message.topic_id ? String(message.topic_id) : "");
    case "user":
      return message.sender_username ?? message.sender_name ?? "";
    case "content":
      return message.text_content ?? message.caption ?? "";
    case "all":
      return "";
  }
}

function evaluateCondition(fieldValue: string, operation: FilterOperation, target: string): boolean {
  const left = fieldValue.toLowerCase();
  const right = target.toLowerCase();

  switch (operation) {
    case "=":
      return left === right;
    case "!=":
      return left !== right;
    case "~":
      return left.includes(right);
    case "!~":
      return !left.includes(right);
  }
}

export function matchRule(message: MessageRow, rule: DistributionRule): boolean {
  const conditions = parseFilterQuery(rule.filter_query);

  if (conditions.length === 0) {
    return false;
  }

  return conditions.every((condition) => {
    if (condition.type === "all") {
      return true;
    }

    return evaluateCondition(getFieldValue(message, condition.type), condition.operation, condition.value);
  });
}

export function findMatchingRule(message: MessageRow, rules: DistributionRule[]): DistributionRule | undefined {
  return rules.find((rule) => matchRule(message, rule));
}
