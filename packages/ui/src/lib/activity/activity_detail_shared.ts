/** 活动适配器共享的输入读取、预览边界与私密引用脱敏；不执行工具或请求模型。 */
import type { SessionAgentToolPart } from "@downcity/type";

/** 读取普通结构化对象。 */
export function object_value(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** 读取字符串字段，保留文件内容的空白。 */
export function text_value(value: unknown): string { return typeof value === "string" ? value : ""; }

/** 候选字段只读取已知类型的简单值。 */
function pick_text(value: unknown, fields: readonly string[]): string {
  const record = object_value(value);
  for (const field of fields) {
    const item = record?.[field];
    if (typeof item === "string" && item) return item;
  }
  return "";
}

/** 文字预览的字符上限，所有详情均可明确提示被省略的内容。 */
export const activity_text_limit = 64 * 1024;
/** 文本预览最多展示的行数，避免大量短行生成过多节点。 */
export const activity_line_limit = 500;

/** 同时限制字符与行数，调用方用长度差异明确提示省略。 */
export function bounded_text(text: string): string {
  return text.slice(0, activity_text_limit).split("\n", activity_line_limit).join("\n");
}

/** Session 私密引用不作为可读正文显示。 */
export function redact_private(text: string): string {
  return text.replace(/\$\{secrets\.[^}]*\}/g, "[private value]");
}

/** 一次展开最多挂载的列表条目数。 */
export const activity_item_limit = 200;

/**
 * 读取 Tool 输入原文中指定字段已经到达的字符串值。
 *
 * Tool 输入原文是模型逐段输出的 JSON 片段，收口前无法整体解析。这里做一次 JSON 字符串词法
 * 扫描：只有紧跟在字段名之后的值才会命中，因此字段名出现在别的文本内容里不会误配；尚未闭合
 * 的值按当前进度返回。同一个字段可以出现多次（例如 edits 数组），按出现顺序全部返回。
 */
export function read_streaming_input_values(input_text: string | undefined, field: string): string[] {
  if (!input_text) return [];
  const values: string[] = [];
  let index = 0;
  while (index < input_text.length) {
    if (input_text[index] !== "\"") {
      index += 1;
      continue;
    }
    const name = read_json_string(input_text, index);
    const colon = skip_whitespace(input_text, name.end);
    if (input_text[colon] !== ":") {
      index = name.end;
      continue;
    }
    const value_start = skip_whitespace(input_text, colon + 1);
    if (input_text[value_start] !== "\"") {
      index = colon + 1;
      continue;
    }
    const value = read_json_string(input_text, value_start);
    index = value.end;
    if (name.text === field) values.push(value.text);
  }
  return values;
}

/** 从 `start` 处的引号读取一个 JSON 字符串；允许尚未闭合。 */
function read_json_string(input_text: string, start: number): { /** 已到达的字符串。 */ text: string; /** 下一扫描位置。 */ end: number } {
  let raw = "";
  for (let index = start + 1; index < input_text.length; index += 1) {
    const character = input_text[index];
    if (character === "\\") {
      raw += character + (input_text[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (character === "\"") return { text: decode_json_string(raw), end: index + 1 };
    raw += character;
  }
  return { text: decode_json_string(raw), end: input_text.length };
}

/** 解码 JSON 字符串内容；片段尚未闭合时退回原文，保证预览始终可读。 */
function decode_json_string(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

/** 跳过空白字符。 */
function skip_whitespace(input_text: string, start: number): number {
  let index = start;
  while (index < input_text.length && /\s/.test(input_text[index])) index += 1;
  return index;
}

/**
 * 读取 Tool 输入字段。
 *
 * Tool 收口后 `input` 是模型给出的结构化参数；收口前只有逐段到达的 JSON 原文，此时按同一组
 * 字段名从原文里读取已经到达的值。摘要与详情因此共享同一条读取规则。
 */
export function read_input(part: SessionAgentToolPart, fields: readonly string[]): string {
  const structured = pick_text(part.input, fields);
  if (structured) return structured;
  if (part.input !== undefined && part.state !== "input-streaming") return "";
  for (const field of fields) {
    const [streamed] = read_streaming_input_values(part.input_text, field);
    if (streamed) return streamed;
  }
  return "";
}
