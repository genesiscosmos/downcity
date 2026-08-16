import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  QqIncomingAttachment,
  QqInboundAttachmentKind,
  QqRawInboundAttachment,
} from "@/chat/types/QqVoice.js";
import type { Logger } from "@downcity/agent";

/**
 * QQ 入站附件候选字段（宽松结构）。
 *
 * 关键点（中文）
 * - QQ 在不同事件类型下字段命名可能不同，统一在这里做“候选位”收敛。
 * - 字段值保持 `unknown`，由解析函数逐步归一化。
 */
type QqVoiceMessagePayload = {
  /**
   * 主附件数组字段。
   */
  attachments?: unknown;
  /**
   * 备用文件数组字段。
   */
  files?: unknown;
  /**
   * 单个或多个文件信息字段（可能是 JSON 字符串）。
   */
  file_info?: unknown;
  /**
   * 备用文件信息数组字段。
   */
  file_infos?: unknown;
  /**
   * 单个媒体字段。
   */
  media?: unknown;
  /**
   * 媒体数组字段。
   */
  medias?: unknown;
  /**
   * 单独音频字段。
   */
  audio?: unknown;
  /**
   * 单独语音字段。
   */
  voice?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toStringOrNumberText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  return "";
}

function pickFirstNonEmptyString(
  obj: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const text = toStringOrEmpty(obj[key]);
    if (text) return text;
  }
  return "";
}

function pickFirstNonEmptyText(
  obj: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const text = toStringOrNumberText(obj[key]);
    if (text) return text;
  }
  return "";
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return value;
  if (!(text.startsWith("{") || text.startsWith("["))) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function isLikelyRemoteUrl(text: string): boolean {
  return /^https?:\/\//i.test(text) || text.startsWith("//");
}

function isLikelyLocalPath(text: string): boolean {
  return text.startsWith("/") || text.startsWith("./") || text.startsWith("../");
}

function withKindHint(
  raw: QqRawInboundAttachment,
  kindHint: "voice" | "audio" | undefined,
): QqRawInboundAttachment {
  if (!kindHint) return raw;
  if (typeof raw.type === "string" && raw.type.trim()) return raw;
  if (typeof raw.media_type === "string" && raw.media_type.trim()) return raw;
  return {
    ...raw,
    type: kindHint,
  };
}

function asRawAttachmentArray(
  value: unknown,
  kindHint: "voice" | "audio" | undefined,
): QqRawInboundAttachment[] {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) {
    return parsed
      .filter(isRecord)
      .map((item) => withKindHint({ ...item }, kindHint));
  }
  if (isRecord(parsed)) {
    return [withKindHint({ ...parsed }, kindHint)];
  }
  const text = toStringOrEmpty(parsed);
  if (text && (isLikelyRemoteUrl(text) || isLikelyLocalPath(text))) {
    // 关键点（中文）：兼容 voice/audio 字段直接给字符串 URL/路径的场景。
    const seeded = isLikelyRemoteUrl(text)
      ? ({ url: text } as QqRawInboundAttachment)
      : ({ local_path: text } as QqRawInboundAttachment);
    return [withKindHint(seeded, kindHint)];
  }
  return [];
}

function inferKindFromHints(hints: string): QqInboundAttachmentKind {
  const text = hints.toLowerCase();
  if (!text) return "unknown";

  if (
    /audio|voice|ogg|opus|mp3|wav|amr|m4a|aac|silk|speex|pcm|ptt|record/.test(
      text,
    )
  ) {
    if (/voice|ogg|opus|amr|silk|speex|ptt|record/.test(text)) return "voice";
    return "audio";
  }
  if (/image|photo|png|jpg|jpeg|webp|gif|bmp/.test(text)) return "photo";
  if (/video|mp4|mov|webm|m4v|avi|mkv/.test(text)) return "video";
  if (/pdf|doc|txt|csv|xls|ppt|zip|rar|file|document/.test(text)) {
    return "document";
  }
  return "unknown";
}

function normalizeOneAttachment(raw: QqRawInboundAttachment): QqIncomingAttachment {
  const rawObj = raw as Record<string, unknown>;
  const attachmentId =
    pickFirstNonEmptyText(rawObj, ["id", "file_id", "media_id", "uuid"]) ||
    undefined;
  const fileName =
    pickFirstNonEmptyString(rawObj, ["filename", "file_name", "name", "title"]) ||
    undefined;
  const contentType =
    pickFirstNonEmptyString(rawObj, [
      "content_type",
      "mime_type",
      "contentType",
      "mimeType",
    ]) || undefined;
  const url =
    pickFirstNonEmptyString(rawObj, [
      "url",
      "download_url",
      "file_url",
      "audio_url",
      "voice_url",
      "href",
      "src",
    ]) || undefined;
  const localPath =
    pickFirstNonEmptyString(rawObj, ["local_path", "path", "file_path"]) ||
    undefined;

  const hints = [
    pickFirstNonEmptyText(rawObj, [
      "type",
      "media_type",
      "file_type",
      "msg_type",
    ]),
    contentType || "",
    fileName || "",
    url || "",
  ]
    .join(" ")
    .trim();

  return {
    kind: inferKindFromHints(hints),
    raw,
    ...(attachmentId ? { attachmentId } : {}),
    ...(fileName ? { fileName } : {}),
    ...(contentType ? { contentType } : {}),
    ...(url ? { url } : {}),
    ...(localPath ? { localPath } : {}),
  };
}

function dedupeAttachments(items: QqIncomingAttachment[]): QqIncomingAttachment[] {
  const seen = new Set<string>();
  const out: QqIncomingAttachment[] = [];
  for (const item of items) {
    const key = [
      item.attachmentId || "",
      item.url || "",
      item.localPath || "",
      item.fileName || "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * 从 QQ 入站 payload 中提取附件集合（best-effort）。
 *
 * 关键点（中文）
 * - 同时兼容数组字段、单对象字段、以及 JSON 字符串字段。
 * - 返回值已做去重，可直接用于后续下载 / 转写流程。
 */
export function extractQqIncomingAttachments(
  payload: QqVoiceMessagePayload,
): QqIncomingAttachment[] {
  const sources = [
    { value: payload.attachments },
    { value: payload.files },
    { value: payload.file_info },
    { value: payload.file_infos },
    { value: payload.media },
    { value: payload.medias },
    { value: payload.audio, kindHint: "audio" as const },
    { value: payload.voice, kindHint: "voice" as const },
  ];

  const rawItems = sources.flatMap((source) =>
    asRawAttachmentArray(source.value, source.kindHint),
  );
  if (rawItems.length === 0) return [];

  const normalized = rawItems.map((raw) => normalizeOneAttachment(raw));
  return dedupeAttachments(normalized);
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name || "").trim();
  if (!base) return "";
  return base.replace(/[^\w.\-()@\u4e00-\u9fff]+/g, "_").slice(0, 160);
}

function normalizeRemoteUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function extFromContentType(contentType: string): string {
  const lower = contentType.toLowerCase();
  if (lower.includes("audio/ogg")) return ".ogg";
  if (lower.includes("audio/opus")) return ".opus";
  if (lower.includes("audio/mpeg")) return ".mp3";
  if (lower.includes("audio/mp4")) return ".m4a";
  if (lower.includes("audio/wav") || lower.includes("audio/x-wav")) return ".wav";
  if (lower.includes("audio/amr")) return ".amr";
  if (lower.includes("video/mp4")) return ".mp4";
  if (lower.includes("image/jpeg")) return ".jpg";
  if (lower.includes("image/png")) return ".png";
  return "";
}

function defaultExtByKind(kind: QqInboundAttachmentKind): string {
  if (kind === "voice") return ".ogg";
  if (kind === "audio") return ".mp3";
  if (kind === "photo") return ".jpg";
  if (kind === "video") return ".mp4";
  return ".bin";
}

async function downloadRemoteAttachment(params: {
  dataPath: string;
  rootPath: string;
  attachment: QqIncomingAttachment;
  authToken?: string;
}): Promise<string> {
  const url = normalizeRemoteUrl(String(params.attachment.url || "").trim());
  if (!url) {
    throw new Error("QQ attachment missing download url");
  }

  const headers =
    typeof params.authToken === "string" && params.authToken.trim()
      ? { Authorization: params.authToken.trim() }
      : undefined;

  let response = await fetch(url, headers ? { headers } : undefined);
  if (!response.ok && headers) {
    // 关键点（中文）：某些下载地址不接受 Authorization 头，失败后回退无头重试。
    response = await fetch(url);
  }
  if (!response.ok) {
    throw new Error(`QQ attachment download failed: HTTP ${response.status}`);
  }

  const buf = Buffer.from(await response.arrayBuffer());
  const responseType = String(response.headers.get("content-type") || "").trim();

  const nameFromUrl = (() => {
    try {
      const u = new URL(url);
      return path.basename(u.pathname || "");
    } catch {
      return "";
    }
  })();

  const baseRaw =
    params.attachment.fileName ||
    nameFromUrl ||
    params.attachment.attachmentId ||
    "qq-attachment";
  const safeBase = sanitizeFileName(baseRaw) || "qq-attachment";

  const ext =
    path.extname(safeBase) ||
    extFromContentType(params.attachment.contentType || "") ||
    extFromContentType(responseType) ||
    defaultExtByKind(params.attachment.kind);

  const dir = path.join(params.dataPath, ".cache", "qq");
  await mkdir(dir, { recursive: true });

  const stem = safeBase.replace(/\.[^.]+$/, "");
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const outPath = path.join(dir, `${uniq}-${stem}${ext}`);
  await writeFile(outPath, buf);
  return outPath;
}

/**
 * 解析 QQ 入站附件的本地路径。
 *
 * 关键点（中文）
 * - 本地已有路径优先直接复用。
 * - 远程 URL 会按需下载到 cache，再返回绝对路径。
 */
export async function resolveQqAttachmentLocalPath(params: {
  /** 当前 AgentWorkspace 的私有数据目录，用于保存下载缓存。 */
  dataPath: string;
  /** 项目根目录，用于解析消息中已有的项目相对路径。 */
  rootPath: string;
  attachment: QqIncomingAttachment;
  authToken?: string;
}): Promise<string> {
  const rawLocal = toStringOrEmpty(params.attachment.localPath);
  if (rawLocal) {
    return path.isAbsolute(rawLocal)
      ? rawLocal
      : path.resolve(params.rootPath, rawLocal);
  }
  if (params.attachment.url) {
    return downloadRemoteAttachment(params);
  }
  return "";
}
