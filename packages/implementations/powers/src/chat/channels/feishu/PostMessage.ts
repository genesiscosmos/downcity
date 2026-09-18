/**
 * Feishu `post` 富文本消息工具。
 *
 * 关键点（中文）
 * - 负责把飞书 `post` 富文本归一化为“纯文本 + 可下载附件”。
 * - 负责把 runtime 内部的正文与图片组合成 Feishu `post` 发送 payload。
 * - 该模块只处理纯函数逻辑，避免继续把结构化消息细节堆进 `Feishu.ts`。
 */

import type { FeishuIncomingAttachmentDescriptor } from "@/chat/types/FeishuInboundAttachment.js";
import type {
  FeishuPostElement,
  FeishuPostInlineImage,
  FeishuPostLocaleContent,
  FeishuPostLinkElement,
  FeishuPostMentionElement,
  FeishuPostPayload,
} from "@/chat/types/FeishuPost.js";

const FEISHU_POST_LOCALE_PRIORITY = [
  "zh_cn",
  "en_us",
  "ja_jp",
  "zh_hk",
  "zh_tw",
] as const;

const MARKDOWN_LINK_REGEXP = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const URL_REGEXP = /https?:\/\/[^\s<>()]+/g;

function asObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Feishu post content must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isLocaleContent(value: unknown): value is FeishuPostLocaleContent {
  const record = asRecord(value);
  if (!record) return false;
  return Array.isArray(record.content) || typeof record.title === "string";
}

function pickLocaleContent(payload: FeishuPostPayload): FeishuPostLocaleContent | undefined {
  for (const locale of FEISHU_POST_LOCALE_PRIORITY) {
    const candidate = payload[locale];
    if (isLocaleContent(candidate)) return candidate;
  }

  for (const value of Object.values(payload)) {
    if (isLocaleContent(value)) return value;
  }

  if (isLocaleContent(payload)) return payload;
  return undefined;
}

function joinFragment(acc: string, next: string): string {
  const current = String(acc || "");
  const fragment = String(next || "");
  if (!current) return fragment;
  if (!fragment) return current;

  const tail = current.slice(-1);
  const head = fragment.slice(0, 1);
  if (
    /\s/.test(tail) ||
    /\s/.test(head) ||
    /[([{'"“‘]/.test(tail) ||
    /[，。！？；：、,.!?:;)\]}'"”’]/.test(head) ||
    (/[\u4e00-\u9fff]/.test(tail) && /[\u4e00-\u9fff]/.test(head))
  ) {
    return `${current}${fragment}`;
  }
  return `${current} ${fragment}`;
}

function normalizeLineText(fragments: string[]): string {
  return fragments.reduce((acc, item) => joinFragment(acc, item.trim()), "").trim();
}

function buildPostImageDescriptor(params: {
  imageKey: string;
  description?: string;
}): FeishuIncomingAttachmentDescriptor {
  const description = readString(params.description);
  return {
    type: "photo",
    resource_type: "image",
    resourceKey: params.imageKey,
    fileName: description || "image",
    description: description || "image",
    raw: {
      resourceKey: params.imageKey,
      imageKey: params.imageKey,
      ...(description ? { fileName: description } : {}),
    },
  };
}

function buildPostFileDescriptor(params: {
  resource_type: "file" | "audio" | "media" | "video";
  resourceKey: string;
  fileName?: string;
  duration?: number;
  imageKey?: string;
}): FeishuIncomingAttachmentDescriptor {
  const fileName = readString(params.fileName);
  return {
    type:
      params.resource_type === "audio"
        ? "audio"
        : params.resource_type === "media" || params.resource_type === "video"
          ? "video"
          : "document",
    resource_type: params.resource_type,
    resourceKey: params.resourceKey,
    ...(fileName ? { fileName } : {}),
    ...(fileName ? { description: fileName } : {}),
    raw: {
      resourceKey: params.resourceKey,
      ...(fileName ? { fileName } : {}),
      ...(typeof params.duration === "number" ? { duration: params.duration } : {}),
      ...(params.imageKey ? { imageKey: params.imageKey } : {}),
    },
  };
}

function formatLinkNode(node: FeishuPostLinkElement): string {
  const label = readString(node.text);
  const href = readString(node.href);
  if (label && href) {
    return label === href ? href : `${label} (${href})`;
  }
  return label || href || "";
}

function formatMentionNode(node: FeishuPostMentionElement): string {
  if (String(node.user_id || "").trim() === "all") return "@all";
  return `@${readString(node.user_name) || readString(node.user_id) || "unknown"}`;
}

function buildAttachmentPlaceholder(params: {
  kind: "图片" | "视频" | "音频" | "文件";
  description?: string;
}): string {
  const description = readString(params.description);
  if (!description) return `[${params.kind}]`;
  return `[${params.kind}: ${description}]`;
}

function parsePostElement(params: {
  element: FeishuPostElement;
  attachments: FeishuIncomingAttachmentDescriptor[];
}): string {
  const element = params.element as Record<string, unknown>;
  const tag = readString(element.tag)?.toLowerCase();
  if (!tag) return "";

  if (tag === "text") {
    return readString(element.text) || "";
  }

  if (tag === "a") {
    return formatLinkNode(element as unknown as FeishuPostLinkElement);
  }

  if (tag === "at") {
    return formatMentionNode(element as unknown as FeishuPostMentionElement);
  }

  if (tag === "img") {
    const imageKey = readString(element.image_key);
    if (!imageKey) return "[图片]";
    const description =
      readString(element.alt) ||
      readString(element.title) ||
      readString(element.text);
    params.attachments.push(
      buildPostImageDescriptor({
        imageKey,
        ...(description ? { description } : {}),
      }),
    );
    return buildAttachmentPlaceholder({
      kind: "图片",
      ...(description ? { description } : {}),
    });
  }

  if (tag === "media" || tag === "video" || tag === "file" || tag === "audio") {
    const fileKey = readString(element.file_key);
    const fileName =
      readString(element.file_name) ||
      readString(element.title) ||
      readString(element.text);
    const duration = readNumber(element.duration);
    const imageKey = readString(element.image_key);
    if (fileKey) {
      params.attachments.push(
        buildPostFileDescriptor({
          resource_type:
            tag === "audio"
              ? "audio"
              : tag === "file"
                ? "file"
                : tag === "video"
                  ? "video"
                  : "media",
          resourceKey: fileKey,
          ...(fileName ? { fileName } : {}),
          ...(typeof duration === "number" ? { duration } : {}),
          ...(imageKey ? { imageKey } : {}),
        }),
      );
    }
    return buildAttachmentPlaceholder({
      kind:
        tag === "audio" ? "音频" : tag === "file" ? "文件" : "视频",
      ...(fileName ? { description: fileName } : {}),
    });
  }

  if (tag === "emotion") {
    const emojiType = readString(element.emoji_type);
    return emojiType ? `[表情:${emojiType}]` : "[表情]";
  }

  if (tag === "hr") {
    return "---";
  }

  const fallback_text =
    readString(element.text) ||
    readString(element.title) ||
    readString(element.href) ||
    readString(element.file_name);
  if (fallback_text) return fallback_text;

  const fallbackImageKey = readString(element.image_key);
  if (fallbackImageKey) {
    params.attachments.push(
      buildPostImageDescriptor({
        imageKey: fallbackImageKey,
      }),
    );
    return "[图片]";
  }

  return "";
}

/**
 * 解析飞书 `post` 入站内容。
 *
 * 说明（中文）
 * - 标题会保留在正文前缀。
 * - 行内图片/媒体会同时降级成文本占位与可下载附件。
 * - 未识别节点采用 best-effort 文本兜底，避免整条消息直接丢失。
 */
export function parseFeishuPostMessageContent(params: {
  content: string;
}): {
  text: string;
  attachments: FeishuIncomingAttachmentDescriptor[];
} {
  const payload = asObject(params.content) as FeishuPostPayload;
  const locale = pickLocaleContent(payload);
  if (!locale) {
    return {
      text: "",
      attachments: [],
    };
  }

  const attachments: FeishuIncomingAttachmentDescriptor[] = [];
  const lines = Array.isArray(locale.content) ? locale.content : [];
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (!Array.isArray(line)) continue;
    const fragments = line
      .map((element) =>
        parsePostElement({
          element: (asRecord(element) || { tag: "" }) as FeishuPostElement,
          attachments,
        }),
      )
      .filter((item) => item.trim().length > 0);

    const text = normalizeLineText(fragments);
    if (text) {
      bodyLines.push(text);
    }
  }

  const title = readString(locale.title);
  const body = bodyLines.join("\n").trim();
  const text = [title, body]
    .filter((item) => String(item || "").trim().length > 0)
    .join(title && body ? "\n\n" : "")
    .trim();

  return {
    text,
    attachments,
  };
}

function splitMarkdownFragments(line: string): Array<string | FeishuPostLinkElement> {
  const out: Array<string | FeishuPostLinkElement> = [];
  let lastIndex = 0;
  MARKDOWN_LINK_REGEXP.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while (true) {
    match = MARKDOWN_LINK_REGEXP.exec(line);
    if (!match) break;
    if (match.index > lastIndex) {
      out.push(line.slice(lastIndex, match.index));
    }
    out.push({
      tag: "a",
      text: match[1],
      href: match[2],
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) {
    out.push(line.slice(lastIndex));
  }
  return out;
}

function splitUrlFragments(line: string): Array<string | FeishuPostLinkElement> {
  const out: Array<string | FeishuPostLinkElement> = [];
  let lastIndex = 0;
  URL_REGEXP.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while (true) {
    match = URL_REGEXP.exec(line);
    if (!match) break;
    if (match.index > lastIndex) {
      out.push(line.slice(lastIndex, match.index));
    }
    out.push({
      tag: "a",
      text: match[0],
      href: match[0],
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) {
    out.push(line.slice(lastIndex));
  }
  return out;
}

function normalizePostTextElementText(text: string): string {
  const normalized = String(text || "").replace(/\r/g, "");
  return normalized.length > 0 ? normalized : " ";
}

function buildFeishuPostLine(line: string): FeishuPostElement[] {
  const markdownTokens = splitMarkdownFragments(line);
  const out: FeishuPostElement[] = [];

  for (const token of markdownTokens) {
    if (typeof token !== "string") {
      out.push(token);
      continue;
    }

    const urlTokens = splitUrlFragments(token);
    for (const urlToken of urlTokens) {
      if (typeof urlToken !== "string") {
        out.push(urlToken);
        continue;
      }
      if (!urlToken.length) continue;
      out.push({
        tag: "text",
        text: normalizePostTextElementText(urlToken),
      });
    }
  }

  return out.length > 0
    ? out
    : [
        {
          tag: "text",
          text: " ",
        },
      ];
}

/**
 * 判断当前正文是否值得走 `post` 发送。
 *
 * 说明（中文）
 * - 纯单行短文本继续走 `text`，减少不必要的平台语义变化。
 * - 多行、链接、Markdown 链接、内联图片时切到 `post`。
 */
export function shouldUseFeishuPostMessage(params: {
  text: string;
  inlineImages?: FeishuPostInlineImage[];
}): boolean {
  const text = String(params.text || "");
  const inlineImages = Array.isArray(params.inlineImages)
    ? params.inlineImages
    : [];
  if (inlineImages.length > 0) return true;
  if (/\r?\n/.test(text)) return true;
  MARKDOWN_LINK_REGEXP.lastIndex = 0;
  if (MARKDOWN_LINK_REGEXP.test(text)) return true;
  MARKDOWN_LINK_REGEXP.lastIndex = 0;
  URL_REGEXP.lastIndex = 0;
  if (URL_REGEXP.test(text)) return true;
  URL_REGEXP.lastIndex = 0;
  return false;
}

/**
 * 构建飞书 `post` 发送 payload。
 *
 * 说明（中文）
 * - 自动把正文按行拆成富文本段落。
 * - Markdown 链接与裸 URL 会转成飞书链接节点。
 * - 图片会以内联 `img` 节点追加到 `post` 内容中。
 */
export function buildFeishuPostMessageContent(params: {
  text: string;
  inlineImages?: FeishuPostInlineImage[];
}): string | undefined {
  const text = String(params.text || "").replace(/\r/g, "");
  const inlineImages = Array.isArray(params.inlineImages)
    ? params.inlineImages
    : [];

  const paragraphs =
    text.trim().length > 0
      ? text
          .split("\n")
          .map((line) => buildFeishuPostLine(line))
          .filter((line) => line.length > 0)
      : [];

  for (const image of inlineImages) {
    const imageKey = readString(image.imageKey);
    if (!imageKey) continue;
    paragraphs.push([
      {
        tag: "img",
        image_key: imageKey,
      },
    ]);
    const caption = readString(image.caption);
    if (caption) {
      paragraphs.push(buildFeishuPostLine(caption));
    }
  }

  if (paragraphs.length === 0) return undefined;

  const content: FeishuPostLocaleContent = {
    title: "",
    content: paragraphs,
  };

  return JSON.stringify({
    zh_cn: content,
    en_us: content,
  });
}
