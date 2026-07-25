/**
 * SessionAttachmentMapper：把 `<file>` 附件描述映射为模型可消费的 file parts。
 *
 * 关键点（中文）
 * - 兼容 Telegram / Feishu / TUI 等统一的 `<file>` 协议入口。
 * - 仅在本轮执行的内存消息上追加 file parts，不修改持久化历史。
 * - 当前只为图片与 PDF 注入 file part，保持多模态模型可直接消费。
 * - 历史中的相对路径与旧版 `file://` 会在喂给模型前临时 hydrate。
 */

import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isFileUIPart,
  isTextUIPart,
  type FileUIPart,
} from "ai";
import type { SessionUserMessagePart } from "@/types/sdk/AgentSessionPrompt.js";
import type {
  SessionRecordV1,
  SessionMessageRecordV1,
} from "@/executor/types/SessionRecords.js";
import { parse_chat_message_markup } from "@/executor/messages/ChatMessageMarkup.js";

/**
 * 从 `<file>` 标签中解析附件描述。
 */
function parseAttachmentLinesFromText(text: string): Array<{
  type: "photo" | "document" | "voice" | "audio" | "video";
  path: string;
  caption?: string;
}> {
  const raw = String(text || "");
  if (!raw.trim()) return [];
  return parse_chat_message_markup(raw).files.map((file) => ({
    type: file.type,
    path: file.path,
    ...(typeof file.caption === "string" && file.caption.trim()
      ? { caption: file.caption.trim() }
      : {}),
  }));
}

function guessAttachmentMediaTypeFromPath(filePath: string): string | undefined {
  const ext = (path.extname(filePath) || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".zip") return "application/zip";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".opus") return "audio/opus";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  if (ext === ".m4v") return "video/x-m4v";
  return undefined;
}

function buildDataUrl(mediaType: string, buffer: Buffer): string {
  const base64 = buffer.toString("base64");
  const safeType = mediaType || "application/octet-stream";
  return `data:${safeType};base64,${base64}`;
}

function resolveHydratableFilePath(
  project_root: string | undefined,
  rawPath: string,
): string | null {
  const raw = String(rawPath || "").trim();
  if (!raw || raw.startsWith("data:") || /^https?:\/\//i.test(raw)) return null;
  if (raw.startsWith("file://")) return fileURLToPath(raw);
  if (path.isAbsolute(raw)) return path.resolve(raw);

  const root = path.resolve(String(project_root || "").trim() || process.cwd());
  const absPath = path.resolve(root, raw);
  const rel = path.relative(root, absPath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return absPath;
}

async function hydrateFileUrlPart(
  part: FileUIPart,
  project_root?: string,
): Promise<FileUIPart> {
  const url = String(part.url || "").trim();
  const filePath = resolveHydratableFilePath(project_root, url);
  if (!filePath) return part;
  try {
    const buffer = await fs.readFile(filePath);
    const mediaType =
      String(part.mediaType || "").trim() ||
      guessAttachmentMediaTypeFromPath(filePath) ||
      "application/octet-stream";
    return {
      ...part,
      mediaType,
      url: buildDataUrl(mediaType, buffer),
    };
  } catch {
    return part;
  }
}

async function hydrateFileUrlPartStrict(
  part: FileUIPart,
  project_root?: string,
): Promise<FileUIPart> {
  const url = String(part.url || "").trim();
  const file_path = resolveHydratableFilePath(project_root, url);
  if (!file_path) return part;

  try {
    const buffer = await fs.readFile(file_path);
    const media_type =
      String(part.mediaType || "").trim() ||
      guessAttachmentMediaTypeFromPath(file_path) ||
      "application/octet-stream";
    return {
      ...part,
      mediaType: media_type,
      url: buildDataUrl(media_type, buffer),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`读取本地附件失败：${file_path}。${message}`);
  }
}

/**
 * 在用户 prompt 入库前，将本地图片 file part 转成 data URL。
 *
 * 关键点（中文）
 * - 只处理调用侧直接传入的图片 file part。
 * - 已经是 data URL 或远程 URL 的附件保持原样。
 * - 本地文件读取失败时直接报错，避免模型请求拿到不可访问的本地路径。
 */
export async function hydrate_user_prompt_file_parts(
  parts: SessionUserMessagePart[],
  project_root?: string,
): Promise<SessionUserMessagePart[]> {
  if (!Array.isArray(parts) || parts.length === 0) return [];

  const out: SessionUserMessagePart[] = [];
  for (const part of parts) {
    if (!isFileUIPart(part as FileUIPart)) {
      out.push(part);
      continue;
    }

    const file_part = part as FileUIPart;
    const media_type = String(file_part.mediaType || "").trim();
    if (!media_type.startsWith("image/")) {
      out.push(part);
      continue;
    }

    const next_part = await hydrateFileUrlPartStrict(file_part, project_root);
    out.push(next_part as SessionUserMessagePart);
  }

  return out;
}

/**
 * 将历史中的资源 file part 临时转换为模型可消费的 data URL。
 *
 * 关键点（中文）
 * - 该函数只修改本轮内存消息，不回写历史。
 * - 新历史保留 Agent 根目录相对路径，旧历史的 `file://` 仍继续兼容。
 */
export async function hydrate_file_url_parts_for_model(
  messages: SessionMessageRecordV1[],
  project_root?: string,
): Promise<SessionMessageRecordV1[]> {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const out: SessionMessageRecordV1[] = [];
  for (const message of messages) {
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    if (!parts.some((part) => isFileUIPart(part as FileUIPart))) {
      out.push(message);
      continue;
    }

    const nextParts: SessionMessageRecordV1["parts"] = [];
    let changed = false;
    for (const part of parts) {
      if (!isFileUIPart(part as FileUIPart)) {
        nextParts.push(part);
        continue;
      }
      const nextPart = await hydrateFileUrlPart(part as FileUIPart, project_root);
      if (nextPart !== part) changed = true;
      nextParts.push(nextPart as SessionMessageRecordV1["parts"][number]);
    }

    out.push(changed ? { ...message, parts: nextParts } : message);
  }

  return out;
}

/**
 * 在 user 消息上注入 FileUIPart，以便多模态模型直接消费本地附件。
 */
export async function inject_file_parts_from_attachments(
  messages: SessionMessageRecordV1[],
  project_root?: string,
): Promise<SessionMessageRecordV1[]> {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const root = path.resolve(String(project_root || "").trim() || process.cwd());
  const out: SessionMessageRecordV1[] = [];

  for (const message of messages) {
    if (!message || typeof message !== "object" || message.role !== "user") {
      out.push(message);
      continue;
    }
    const parts = Array.isArray(message.parts) ? message.parts : [];
    if (parts.length === 0) {
      out.push(message);
      continue;
    }

    if (parts.some((part) => isFileUIPart(part as FileUIPart))) {
      out.push(message);
      continue;
    }

    const fullText = parts
      .map((part) => {
        const candidate = part as unknown;
        if (!isTextUIPart(candidate as any)) return "";
        const value = (candidate as { text?: unknown }).text;
        return typeof value === "string" ? value : "";
      })
      .filter((text) => text)
      .join("\n");
    if (!fullText.trim()) {
      out.push(message);
      continue;
    }

    const attachments = parseAttachmentLinesFromText(fullText);
    if (attachments.length === 0) {
      out.push(message);
      continue;
    }

    const fileParts: FileUIPart[] = [];

    for (const attachment of attachments) {
      const mediaTypeGuess = guessAttachmentMediaTypeFromPath(attachment.path);
      if (
        !mediaTypeGuess ||
        (!mediaTypeGuess.startsWith("image/") && mediaTypeGuess !== "application/pdf")
      ) {
        continue;
      }

      const absPath = path.isAbsolute(attachment.path)
        ? attachment.path
        : path.resolve(root, attachment.path);
      try {
        const exists = await fs.pathExists(absPath);
        if (!exists) continue;
        const buffer = await fs.readFile(absPath);
        const dataUrl = buildDataUrl(mediaTypeGuess, buffer);
        const filename = path.basename(absPath) || "image";

        fileParts.push({
          type: "file",
          mediaType: mediaTypeGuess,
          filename,
          url: dataUrl,
        });
      } catch {
        continue;
      }
    }

    if (fileParts.length === 0) {
      out.push(message);
      continue;
    }

    out.push({
      ...message,
      parts: [...parts, ...fileParts],
    });
  }

  return out;
}
