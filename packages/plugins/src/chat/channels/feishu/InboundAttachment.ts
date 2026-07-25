import path from "path";
import type {
  FeishuInboundAttachmentPayload,
  FeishuInboundMessageType,
  FeishuIncomingAttachmentDescriptor,
} from "@/chat/types/FeishuInboundAttachment.js";
import { parseFeishuPostMessageContent } from "./PostMessage.js";

/**
 * Feishu 入站附件工具。
 *
 * 关键点（中文）
 * - 负责把飞书原始 `message_type + content` 归一化成可下载的附件描述。
 * - 负责生成本地缓存文件名与 `<file>` 标签展示名，避免这些细节继续堆在主 channel 文件里。
 */

function asObject(content: string): Record<string, unknown> {
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Feishu message content must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function normalizeMessageType(value: string): FeishuInboundMessageType | undefined {
  const text = String(value || "").trim().toLowerCase();
  if (
    text === "text" ||
    text === "post" ||
    text === "image" ||
    text === "file" ||
    text === "audio" ||
    text === "media" ||
    text === "video"
  ) {
    return text;
  }
  return undefined;
}

function readString(
  payload: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readNumber(
  payload: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function buildDescriptor(
  messageType: Exclude<FeishuInboundMessageType, "text">,
  payload: Record<string, unknown>,
): FeishuIncomingAttachmentDescriptor | undefined {
  const fileKey = readString(payload, ["file_key"]);
  const imageKey = readString(payload, ["image_key"]);
  const fileName = readString(payload, ["file_name", "name", "title"]);
  const duration = readNumber(payload, ["duration"]);

  const raw: FeishuInboundAttachmentPayload = {
    resourceKey:
      messageType === "image" ? String(imageKey || "") : String(fileKey || ""),
    ...(fileName ? { fileName } : {}),
    ...(typeof duration === "number" ? { duration } : {}),
    ...(imageKey ? { imageKey } : {}),
  };

  if (messageType === "image" && imageKey) {
    return {
      type: "photo",
      resource_type: "image",
      resourceKey: imageKey,
      fileName: fileName || "image",
      description: fileName || "image",
      raw,
    };
  }

  if (messageType === "file" && fileKey) {
    return {
      type: "document",
      resource_type: "file",
      resourceKey: fileKey,
      ...(fileName ? { fileName } : {}),
      ...(fileName ? { description: fileName } : {}),
      raw,
    };
  }

  if (messageType === "audio" && fileKey) {
    return {
      type: "audio",
      resource_type: "audio",
      resourceKey: fileKey,
      fileName: fileName || "audio",
      description: fileName || "audio",
      raw,
    };
  }

  if ((messageType === "media" || messageType === "video") && fileKey) {
    return {
      type: "video",
      resource_type: messageType,
      resourceKey: fileKey,
      fileName: fileName || "video.mp4",
      description: fileName || "video",
      raw,
    };
  }

  return undefined;
}

function sanitizeBaseName(value: string): string {
  const normalized = String(value || "").trim();
  const base = path.basename(normalized);
  return (
    base.replace(/[^\w.\-()@\u4e00-\u9fff]+/g, "_").slice(0, 160) || "attachment"
  );
}

function decodeContentDispositionName(headerValue: string): string | undefined {
  const raw = String(headerValue || "").trim();
  if (!raw) return undefined;

  const utf8Match = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  const quotedMatch = raw.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1].trim();

  const plainMatch = raw.match(/filename\s*=\s*([^;]+)/i);
  if (plainMatch?.[1]) return plainMatch[1].trim();

  return undefined;
}

function extFromMimeType(mimeType: string): string | undefined {
  const value = String(mimeType || "").trim().toLowerCase().split(";")[0];
  if (!value) return undefined;
  if (value === "image/jpeg") return ".jpg";
  if (value === "image/png") return ".png";
  if (value === "image/webp") return ".webp";
  if (value === "image/gif") return ".gif";
  if (value === "video/mp4") return ".mp4";
  if (value === "video/quicktime") return ".mov";
  if (value === "video/webm") return ".webm";
  if (value === "audio/ogg") return ".ogg";
  if (value === "audio/mpeg") return ".mp3";
  if (value === "audio/mp4") return ".m4a";
  if (value === "application/pdf") return ".pdf";
  if (value === "text/plain") return ".txt";
  return undefined;
}

function defaultExtByAttachmentType(
  attachment: FeishuIncomingAttachmentDescriptor,
): string {
  if (attachment.type === "photo") return ".jpg";
  if (attachment.type === "video") return ".mp4";
  if (attachment.type === "audio" || attachment.type === "voice") return ".ogg";
  return ".bin";
}

/**
 * 解析飞书入站消息。
 *
 * 说明（中文）
 * - 文本消息返回正文。
 * - `post` 消息会降级成“纯文本 + 附件占位”。
 * - 附件消息返回归一化附件描述；正文通常为空。
 * - 不支持的 `message_type` 会返回 `unsupportedType`，由上层决定是否提示用户。
 */
export function parseFeishuInboundMessage(params: {
  messageType: string;
  content: string;
}): {
  text: string;
  attachments: FeishuIncomingAttachmentDescriptor[];
  unsupportedType?: string;
} {
  const messageType = normalizeMessageType(params.messageType);
  if (!messageType) {
    return {
      text: "",
      attachments: [],
      unsupportedType: String(params.messageType || "").trim() || "unknown",
    };
  }

  const payload = asObject(params.content);
  if (messageType === "text") {
    const text = typeof payload.text === "string" ? payload.text : "";
    return { text, attachments: [] };
  }

  if (messageType === "post") {
    return parseFeishuPostMessageContent({
      content: params.content,
    });
  }

  const descriptor = buildDescriptor(messageType, payload);
  return {
    text: "",
    attachments: descriptor ? [descriptor] : [],
  };
}

/**
 * 生成飞书入站附件的本地缓存文件名。
 *
 * 关键点（中文）
 * - 优先使用服务端返回的 `Content-Disposition` 文件名。
 * - 若无文件名，则回退到附件原始文件名，再根据 MIME 或类型补扩展名。
 */
export function buildFeishuInboundCacheFileName(params: {
  attachment: FeishuIncomingAttachmentDescriptor;
  message_id: string;
  headers?: Record<string, unknown>;
}): string {
  const headers = params.headers || {};
  const contentDisposition = String(
    headers["content-disposition"] || headers["Content-Disposition"] || "",
  );
  const contentType = String(headers["content-type"] || headers["Content-Type"] || "");
  const headerName = decodeContentDispositionName(contentDisposition);
  const sourceName = headerName || params.attachment.fileName || params.attachment.description || "attachment";
  const safeBase = sanitizeBaseName(sourceName);
  const currentExt = path.extname(safeBase);
  const ext =
    currentExt ||
    extFromMimeType(contentType) ||
    defaultExtByAttachmentType(params.attachment);
  const baseWithoutExt = currentExt ? safeBase.slice(0, -currentExt.length) : safeBase;
  const uniq = `${Date.now()}-${String(params.message_id || "").slice(0, 12) || "feishu"}`;
  return `${uniq}-${baseWithoutExt}${ext}`;
}
