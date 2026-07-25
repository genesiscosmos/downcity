/**
 * Chat 消息标记语法解析工具。
 *
 * 关键点（中文）
 * - 统一处理 frontmatter metadata 与 `<file>` 附件标签。
 * - 解析结果保留 `segments[]`，用于按正文与附件的真实顺序发送。
 */

import yaml from "js-yaml";
import type {
  ChatMessageFileSegment,
  ChatMessageFileTag,
  ChatMessageFileType,
  ChatMessageSegment,
  ChatMessageTextSegment,
  ParsedChatMessageMarkup,
} from "./ChatMessageMarkupTypes.js";

const FILE_TAG_REGEXP =
  /<file\b([^>]*?)(?:>([\s\S]*?)<\/file>|\/>)/gi;
const FRONTMATTER_REGEXP = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * 解析标签属性。
 */
function parseTagAttributes(rawAttrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attrs = String(rawAttrs || "");
  const regexp = /([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null = null;
  while (true) {
    match = regexp.exec(attrs);
    if (!match) break;
    const key = normalizeText(match[1]).toLowerCase();
    if (!key) continue;
    const value = normalizeText(match[2] ?? match[3] ?? "");
    out[key] = value;
  }
  return out;
}

/**
 * 归一化附件类型。
 */
export function normalizeChatMessageFileType(value: unknown): ChatMessageFileType {
  const text = normalizeText(value).toLowerCase();
  if (text === "photo" || text === "image") return "photo";
  if (text === "voice") return "voice";
  if (text === "audio") return "audio";
  if (text === "video") return "video";
  return "document";
}

/**
 * 提取 frontmatter metadata。
 */
export function extractChatMessageFrontmatter(params: {
  source: string;
}): {
  metadata: Record<string, unknown>;
  body: string;
} {
  const source = String(params.source || "");
  const match = FRONTMATTER_REGEXP.exec(source);
  if (!match) {
    return {
      metadata: {},
      body: source,
    };
  }

  const yamlRaw = String(match[1] || "");
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(yamlRaw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    return {
      metadata: {},
      body: source,
    };
  }

  return {
    metadata,
    body: source.slice(match[0].length),
  };
}

function toTextSegment(text: string): ChatMessageTextSegment | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  return {
    kind: "text",
    text: normalized,
  };
}

function toFileSegment(file: ChatMessageFileTag): ChatMessageFileSegment | null {
  const path = normalizeText(file.path);
  if (!path) return null;
  return {
    kind: "file",
    file: {
      path,
      type: normalizeChatMessageFileType(file.type),
      ...(normalizeText(file.caption)
        ? { caption: normalizeText(file.caption) }
        : {}),
    },
  };
}

/**
 * 提取 `<file>` 标签，并保留正文/附件的真实顺序。
 */
export function extractChatMessageSegments(source: string): ChatMessageSegment[] {
  const out: ChatMessageSegment[] = [];
  const text = String(source || "");

  FILE_TAG_REGEXP.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null = null;
  while (true) {
    match = FILE_TAG_REGEXP.exec(text);
    if (!match) break;

    const rawBefore = text.slice(cursor, match.index);
    const textSegment = toTextSegment(rawBefore);
    if (textSegment) out.push(textSegment);

    const attrs = parseTagAttributes(match[1] || "");
    const path = normalizeText(match[2] || attrs.path);
    const fileSegment = toFileSegment({
      path,
      type: normalizeChatMessageFileType(attrs.type),
      ...(normalizeText(attrs.caption) ? { caption: normalizeText(attrs.caption) } : {}),
    });
    if (fileSegment) out.push(fileSegment);
    cursor = match.index + match[0].length;
  }

  const trailingText = toTextSegment(text.slice(cursor));
  if (trailingText) out.push(trailingText);
  return out;
}

/**
 * 提取 `<file>` 标签列表。
 */
export function extractChatMessageFileTags(source: string): ChatMessageFileTag[] {
  return extractChatMessageSegments(source)
    .filter((segment): segment is ChatMessageFileSegment => segment.kind === "file")
    .map((segment) => segment.file);
}

/**
 * 移除正文中的 `<file>` 标签，仅保留文本段。
 */
export function stripChatMessageFileTags(source: string): string {
  return build_chat_message_text({
    segments: extractChatMessageSegments(source).filter(
      (segment): segment is ChatMessageTextSegment => segment.kind === "text",
    ),
  });
}

function normalizeTagAttributeValue(value: string, quote: '"' | "'"): string {
  if (quote === '"') {
    return value.replace(/"/g, "'");
  }
  return value.replace(/'/g, '"');
}

/**
 * 渲染一条标准化 `<file>` 标签。
 */
export function render_chat_message_file_tag(file: ChatMessageFileTag): string {
  const path = normalizeText(file.path);
  if (!path) return "";
  const type = normalizeChatMessageFileType(file.type);
  const caption = normalizeText(file.caption);
  const quote: '"' | "'" = caption.includes('"') && !caption.includes("'") ? "'" : '"';
  const safeCaption = caption
    ? normalizeTagAttributeValue(caption, quote)
    : "";
  const captionAttr = safeCaption ? ` caption=${quote}${safeCaption}${quote}` : "";
  return `<file type="${type}"${captionAttr}>${path}</file>`;
}

function renderChatMessageSegment(segment: ChatMessageSegment): string {
  if (segment.kind === "text") return normalizeText(segment.text);
  return render_chat_message_file_tag(segment.file);
}

/**
 * 把附件列表渲染回统一的 `<file>` 文本块。
 */
export function buildChatMessageFileBlock(files: ChatMessageFileTag[]): string {
  return files
    .map((file) => render_chat_message_file_tag(file))
    .filter((item) => normalizeText(item).length > 0)
    .join("\n");
}

/**
 * 把片段重建成统一消息文本。
 */
export function build_chat_message_text(params: {
  body_text?: string;
  files?: ChatMessageFileTag[];
  segments?: ChatMessageSegment[];
}): string {
  const segments = Array.isArray(params.segments)
    ? params.segments
    : [
        ...(normalizeText(params.body_text)
          ? [{
              kind: "text",
              text: normalizeText(params.body_text),
            } satisfies ChatMessageTextSegment]
          : []),
        ...(Array.isArray(params.files)
          ? params.files
              .map((file) => toFileSegment(file))
              .filter((item): item is ChatMessageFileSegment => Boolean(item))
          : []),
      ];

  return segments
    .map((segment) => renderChatMessageSegment(segment))
    .filter((item) => normalizeText(item).length > 0)
    .join("\n\n")
    .trim();
}

/**
 * 统一解析一段 chat 消息文本。
 */
export function parse_chat_message_markup(source: string): ParsedChatMessageMarkup {
  const extracted = extractChatMessageFrontmatter({
    source: String(source || ""),
  });
  const segments = extractChatMessageSegments(extracted.body);
  return {
    metadata: extracted.metadata,
    body_text: build_chat_message_text({
      segments: segments.filter(
        (segment): segment is ChatMessageTextSegment => segment.kind === "text",
      ),
    }),
    files: segments
      .filter((segment): segment is ChatMessageFileSegment => segment.kind === "file")
      .map((segment) => segment.file),
    segments,
  };
}
