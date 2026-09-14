/**
 * InboundPromptParts：构造 chat 入站 user message 的结构化 parts。
 *
 * 关键点（中文）
 * - 运行时事实使用 Session 原生 context part，不再手写 `<info>` 字符串。
 * - tag 校验与 XML 转义由 Session 层统一负责，本模块只提供未转义的原始值。
 * - part 顺序固定：`info` -> `chat-environment` -> 用户正文。
 */

import type { PluginSessionPromptContent } from "@downcity/city/plugin";
import { CHAT_ENVIRONMENT_CONTEXT_TAG, CHAT_INFO_CONTEXT_TAG } from "@downcity/type";
import {
  format_date_time_in_timezone,
  resolve_runtime_timezone,
} from "@downcity/agent";
import type {
  ChatEnvironmentPromptInput,
  InboundUserInfoInput,
} from "@/chat/types/ChatPromptContext.js";
import { render_chat_environment_body } from "./ChatEnvironment.js";

/**
 * 归一化单行元信息值。
 *
 * 说明（中文）
 * - 只做换行折叠与 trim，保证一行一个字段。
 * - 不再手工转义 `<` `>` `&`：转义由 Session 层 `escape_xml_text` 统一处理。
 */
function normalize_info_value(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .trim();
}

/** 归一化接收时间；缺失或不可解析时回退到当前时间。 */
function normalize_received_at_iso(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  const date = raw ? new Date(raw) : new Date();
  if (!Number.isFinite(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

/** 渲染用户与请求元信息 context part 正文。 */
function render_user_info_body(input: InboundUserInfoInput): string {
  const runtime_timezone = resolve_runtime_timezone();
  const received_at = normalize_received_at_iso(input.receivedAt);
  const lines = [
    `message_id: ${normalize_info_value(input.message_id) || "unknown"}`,
    `user_id: ${normalize_info_value(input.user_id) || "unknown"}`,
    `username: ${normalize_info_value(input.username) || "unknown"}`,
    `received_at: ${received_at}`,
    `received_at_local: ${format_date_time_in_timezone(new Date(received_at), runtime_timezone)}`,
    `runtime_timezone: ${runtime_timezone}`,
  ];
  const user_timezone = normalize_info_value(input.userTimezone);
  if (user_timezone) lines.push(`user_timezone: ${user_timezone}`);
  return lines.join("\n");
}

/**
 * 构造 chat 入站 user message 的 parts。
 *
 * 说明（中文）
 * - 顺序固定为 `[context(info), context(chat-environment), text(body)]`。
 * - 正文为空时省略 text part，不写入空 part。
 */
export function build_inbound_prompt_parts(params: {
  /** 本轮用户与请求元信息，以及用户原始正文。 */
  info: InboundUserInfoInput & { /** 用户原始输入正文，可为空。 */ text: string };
  /** 本轮 chat 路由环境事实。 */
  environment: ChatEnvironmentPromptInput;
}): PluginSessionPromptContent[] {
  const parts: PluginSessionPromptContent[] = [
    {
      type: "context",
      tag: CHAT_INFO_CONTEXT_TAG,
      context: render_user_info_body(params.info),
    },
    {
      type: "context",
      tag: CHAT_ENVIRONMENT_CONTEXT_TAG,
      context: render_chat_environment_body(params.environment),
    },
  ];
  const body = String(params.info.text ?? "").trim();
  if (body) parts.push({ type: "text", text: body });
  return parts;
}
