/**
 * read 图片结果与模型 UserMessage 的桥接。
 *
 * 关键点（中文）
 * - Shell read 只负责把图片读取为 data URL。
 * - Agent 在当前 turn 的下一 step 注入临时 user file part，不写入长期历史。
 * - 注入后从普通 tool result 移除 data URL，避免图片同时作为 JSON 内容传给模型。
 */

import path from "node:path";
import { generate_id } from "@/utils/Id.js";
import type { SessionRunContext } from "@/types/executor/SessionRunContext.js";

/** 把普通对象归一为可检查的记录。 */
function to_record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * 在 read 返回图片时注入下一 step，并返回不含 data URL 的 tool result。
 */
export function inject_read_image_user_message(params: {
  /** 当前工具名称。 */
  tool_name: string;
  /** 工具原始执行结果。 */
  output: unknown;
  /** 当前 Session turn 的显式运行上下文。 */
  run_context: SessionRunContext;
}): unknown {
  if (params.tool_name !== "read") return params.output;
  const output = to_record(params.output);
  if (!output || output.success !== true || output.type !== "image") {
    return params.output;
  }
  const data_url = String(output.data_url || "").trim();
  const media_type = String(output.mime_type || "").trim();
  const file_path = String(output.file_path || "").trim();
  if (!data_url.startsWith("data:image/") || !media_type.startsWith("image/")) {
    return params.output;
  }

  params.run_context.injected_user_messages.push({
    id: `read-image:${generate_id()}`,
    role: "user",
    metadata: {
      v: 1,
      ts: Date.now(),
      session_id: params.run_context.session_id,
      ...(params.run_context.turn_id
        ? { turn_id: params.run_context.turn_id }
        : {}),
      source: "ingress",
      kind: "normal",
      extra: {
        internal: "read_image",
        file_path,
      },
    },
    parts: [
      {
        type: "text",
        text: `Image read from ${file_path || "project file"}.`,
      },
      {
        type: "file",
        mediaType: media_type,
        url: data_url,
        ...(file_path ? { filename: path.basename(file_path) } : {}),
      },
    ],
  });

  const { data_url: _data_url, ...result } = output;
  return {
    ...result,
    image_attached: true,
  };
}
