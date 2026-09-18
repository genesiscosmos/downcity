import type {
  FeishuAttachmentType,
  ParsedFeishuAttachmentCommand,
} from "@/chat/types/FeishuAttachment.js";
import { parse_chat_message_markup } from "@downcity/agent";

/**
 * Feishu channel 公共工具。
 *
 * 关键点（中文）
 * - 解析回复文本中的 `<file ...>` 附件标签。
 * - 返回“净化后的正文 + 附件列表 + 有序 segments”，便于按真实顺序出站。
 */

function normalizeAttachmentType(value: string): FeishuAttachmentType {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "image" || raw === "photo") return "photo";
  if (raw === "file" || raw === "document") return "document";
  if (raw === "video") return "video";
  if (raw === "audio") return "audio";
  return "voice";
}

/**
 * 从文本中解析 `<file>` 附件标签。
 *
 * 说明（中文）
 * - `<file>` 标签会从正文中移除并写入 attachments。
 * - 其他自然语言正文保持原样，支持正文与附件混写。
 * - `segments` 会保留文本与附件的原始交错顺序。
 */
export function parseFeishuAttachments(text: string): {
  text: string;
  attachments: ParsedFeishuAttachmentCommand[];
  segments: Array<
    | {
        kind: "text";
        text: string;
      }
    | {
        kind: "attachment";
        attachment: ParsedFeishuAttachmentCommand;
      }
  >;
} {
  const parsed = parse_chat_message_markup(text);
  const attachments: ParsedFeishuAttachmentCommand[] = parsed.files.map((file) => ({
    type: normalizeAttachmentType(file.type),
    pathOrUrl: String(file.path || "").trim(),
    ...(typeof file.caption === "string" && file.caption.trim()
      ? { caption: file.caption.trim() }
      : {}),
  })).filter((item) => item.pathOrUrl);

  const segments: Array<
    | {
        kind: "text";
        text: string;
      }
    | {
        kind: "attachment";
        attachment: ParsedFeishuAttachmentCommand;
      }
  > = [];
  for (const segment of parsed.segments) {
    if (segment.kind === "text") {
      if (segment.text) {
        segments.push({
          kind: "text",
          text: segment.text,
        });
      }
      continue;
    }
    const attachment = {
      type: normalizeAttachmentType(segment.file.type),
      pathOrUrl: String(segment.file.path || "").trim(),
      ...(typeof segment.file.caption === "string" && segment.file.caption.trim()
        ? { caption: segment.file.caption.trim() }
        : {}),
    } satisfies ParsedFeishuAttachmentCommand;
    if (!attachment.pathOrUrl) continue;
    segments.push({
      kind: "attachment",
      attachment,
    });
  }

  return {
    text: parsed.body_text,
    attachments,
    segments,
  };
}
