/**
 * Chat 入站语音自动转写。
 *
 * 关键点（中文）
 * - 能力归 City、触发归 chat：chat 只负责识别入站音频附件并调用 City 的 sound capability。
 * - 转写失败不阻塞 chat 主消息链路，也不写入部分结果。
 * - City 未登记 sound capability 时静默跳过，而不是让入站消息失败。
 */

import path from "node:path";
import type { PluginContext } from "@downcity/city/plugin";
import type {
  ChatInboundAugmentInput,
  ChatPluginAttachment,
} from "@/chat/types/ChatPlugin.js";

/** 自动转写使用的 method 标识。 */
const SOUND_METHOD_ID = "sound";

/** 判断值是否为普通对象。 */
function to_record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** XML 文本转义。 */
function escape_xml_text(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** XML 属性转义。 */
function escape_xml_attr(value: string): string {
  return escape_xml_text(value).replace(/"/g, "&quot;");
}

/** 归一化可选字符串。 */
function normalize_optional_string(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

/** 生成入站附件的展示路径：Workspace 内路径转为相对路径。 */
function to_display_src(root_path: string, attachment: ChatPluginAttachment): string {
  const raw = normalize_optional_string(attachment.path)
    ?? attachment.fileName
    ?? attachment.attachmentId
    ?? attachment.kind;
  const normalized_root = path.resolve(root_path);
  const normalized_raw = path.isAbsolute(raw) ? path.resolve(raw) : raw;
  if (
    path.isAbsolute(normalized_raw)
    && normalized_raw.startsWith(`${normalized_root}${path.sep}`)
  ) {
    return normalized_raw.slice(normalized_root.length + 1);
  }
  return raw;
}

/**
 * 把入站语音附件转写成 `<voice>` 块并追加到正文。
 *
 * 关键点（中文）
 * - 只处理带本地路径的 voice / audio 附件。
 * - 单个附件失败只跳过该附件，保留其余结果。
 */
export async function transcribe_inbound_voice(input: {
  /** 当前 Plugin 执行上下文。 */
  context: PluginContext;
  /** 已归一化的入站输入。 */
  inbound: ChatInboundAugmentInput;
}): Promise<ChatInboundAugmentInput> {
  const methods = input.context.city.methods;
  if (!methods.has(SOUND_METHOD_ID)) return input.inbound;

  const voice_attachments = (Array.isArray(input.inbound.attachments)
    ? input.inbound.attachments
    : [])
    .filter((item) =>
      (item.kind === "voice" || item.kind === "audio")
      && Boolean(normalize_optional_string(item.path))
    );
  if (voice_attachments.length === 0) return input.inbound;

  const voice_blocks: string[] = [];
  for (const attachment of voice_attachments) {
    try {
      const result = to_record(await methods.invoke({
        method: SOUND_METHOD_ID,
        action: "transcribe",
        input: {
          audio_path: String(attachment.path || "").trim(),
          ...(attachment.contentType ? { media_type: attachment.contentType } : {}),
          ...(attachment.fileName ? { filename: attachment.fileName } : {}),
        },
      }));
      const text = normalize_optional_string(result?.text);
      if (!text) continue;
      const src = to_display_src(input.context.workspace.path, attachment);
      voice_blocks.push(`<voice src="${escape_xml_attr(src)}">${escape_xml_text(text)}</voice>`);
    } catch {
      // 关键点（中文）：自动转写失败不阻塞 chat 主消息链路。
    }
  }
  if (voice_blocks.length === 0) return input.inbound;

  const current = normalize_optional_string(input.inbound.body_text);
  return {
    ...input.inbound,
    body_text: [current, ...voice_blocks].filter(Boolean).join("\n\n"),
  };
}
