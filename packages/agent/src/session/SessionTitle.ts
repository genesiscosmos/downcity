/**
 * SDK Session 标题生成与持久化辅助。
 *
 * 关键点（中文）
 * - session title 是 `session_state` 的字段，列表与详情都以它为准。
 * - title 默认允许为空；只有模型成功生成标题时才会写入。
 * - 当 title 仍为空时，后续执行链路可以再次尝试生成。
 */

import type { ModelClient } from "@downcity/type";
import {
  build_text_model_messages,
  generate_model,
} from "@executor/model/ModelGenerate.js";
import type { SessionHistoryMeta } from "@/executor/types/SessionHistoryMeta.js";
import type { Logger } from "@/utils/logger/Logger.js";
import { normalize_session_title } from "@/session/storage/Metadata.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionMessage } from "@downcity/type";
import { extract_session_message_text } from "@/session/messages/SessionMessageText.js";
import type { ModelRequestFailureReporter } from "@/types/executor/ModelRequest.js";

const GENERATED_SESSION_TITLE_MAX_CHARS = 24;

/**
 * 标题持久化参数。
 */
export interface EnsureSessionTitleParams {
  /** 当前 Session 的领域持久化入口。 */
  store: SessionStorage;

  /**
   * 当前 session_id。
   */
  session_id: string;

  /**
   * 当前 session 已落盘消息。
   */
  messages: SessionMessage[];

  /**
   * 可选模型实例；传入时会尝试生成更短标题。
   */
  model?: ModelClient;

  /**
   * 当前模型展示标签；仅用于排障日志，不参与生成逻辑。
   */
  model_label?: string;

  /**
   * 当前 session 运行日志器；标题生成失败时仅记录摘要，不影响主流程。
   */
  logger?: Logger;

  /**
   * 是否允许调用模型生成标题。
   */
  generate?: boolean;

  /** 可选的标题请求取消信号。 */
  signal?: AbortSignal;

  /** 可选的模型请求逐次失败通知入口。 */
  on_model_request_failure?: ModelRequestFailureReporter;

  /** 可选的标题提交入口，用于与其他 metadata mutation 串行化。 */
  commit_title?: (title: string) => Promise<SessionHistoryMeta>;
}

function truncate_title(input: string, max_chars: number): string {
  const title = String(input || "").replace(/\s+/g, " ").trim();
  if (!title) return "";
  if (title.length <= max_chars) return title;
  return title.slice(0, max_chars).trimEnd();
}

function resolve_first_user_text(messages: SessionMessage[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = extract_session_message_text(message);
    if (text) return text;
  }
  return "";
}

function normalize_generated_title(input: string): string | undefined {
  const first_line = String(input || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  const title = normalize_session_title(
    String(first_line || "")
      .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
      .replace(/^标题[:：]\s*/i, "")
      .trim(),
  );
  return title
    ? truncate_title(title, GENERATED_SESSION_TITLE_MAX_CHARS)
    : undefined;
}

function summarize_title_error(error: unknown): {
  /**
   * 错误对象名称。
   */
  name: string | null;

  /**
   * 错误消息摘要。
   */
  message: string | null;

  /**
   * 字符串化后的错误摘要。
   */
  error: string;
} {
  const record =
    error && typeof error === "object" && !Array.isArray(error)
      ? (error as Record<string, unknown>)
      : {};
  return {
    name: typeof record.name === "string" ? record.name : null,
    message: typeof record.message === "string" ? record.message : null,
    error: String(error),
  };
}

async function log_session_title_diagnostic(input: {
  /**
   * 当前 session 标识。
   */
  session_id: string;

  /**
   * 日志级别。
   */
  level: "debug" | "warn";

  /**
   * 日志消息。
   */
  message: string;

  /**
   * 结构化日志字段。
   */
  details: Record<string, string | number | boolean | null | undefined>;

  /**
   * 当前 session 运行日志器。
   */
  logger?: Logger;
}): Promise<void> {
  if (!input.logger) return;
  try {
    await input.logger.log(input.level, input.message, {
      session_id: input.session_id,
      ...input.details,
    });
  } catch {
    // 关键点（中文）：标题诊断日志失败不能影响 session 主流程。
  }
}

/** 根据首条用户消息生成规范化后的会话标题。 */
export async function generate_session_title(input: {
  /**
   * 当前模型实例。
   */
  model: ModelClient;

  /**
   * 当前 session 标识。
   */
  session_id: string;

  /**
   * 当前模型展示标签；仅用于排障日志。
   */
  model_label?: string;

  /**
   * 首条用户消息文本。
   */
  first_user_text: string;

  /**
   * 当前 session 运行日志器。
   */
  logger?: Logger;

  /** 标题请求取消信号。 */
  signal?: AbortSignal;

  /** 可选的模型请求逐次失败通知入口。 */
  on_model_request_failure?: ModelRequestFailureReporter;
}): Promise<string | undefined> {
  try {
    const result = await generate_model(input.model, {
      messages: build_text_model_messages(
        "You generate minimal conversation titles. Output only the title itself, with no explanation and no quotation marks.",
        [
        "Generate a short conversation title from the first user message below.",
        "Requirements: 3 to 12 Chinese characters or 2 to 6 English words; no period; no prefix.",
        "",
        input.first_user_text,
        ].join("\n"),
      ),
    }, {
      request_kind: "session_title",
      signal: input.signal,
      on_failure: input.on_model_request_failure,
    });
    const text = result.text;
    const generated_title = normalize_generated_title(text);
    if (!generated_title) {
      await log_session_title_diagnostic({
        logger: input.logger,
        session_id: input.session_id,
        level: "warn",
        message: "[agent] session_title.empty",
        details: {
          model_label: input.model_label || null,
          firstUserTextLength: input.first_user_text.length,
          rawTitleLength: String(text || "").length,
        },
      });
    }
    return generated_title;
  } catch (error) {
    const effective_error = error;
    await log_session_title_diagnostic({
      logger: input.logger,
      session_id: input.session_id,
      level: "warn",
      message: "[agent] session_title.generate_failed",
      details: {
        model_label: input.model_label || null,
        firstUserTextLength: input.first_user_text.length,
        ...summarize_title_error(effective_error),
      },
    });
    // 关键点（中文）：标题生成失败不能影响 session 主流程。
    return undefined;
  }
}

/**
 * 确保当前 session meta 中持久化 title。
 */
export async function ensure_session_title(
  input: EnsureSessionTitleParams,
): Promise<SessionHistoryMeta> {
  const current = await input.store.read_metadata();
  if (current.title) return current;

  const first_user_text = resolve_first_user_text(input.messages);
  if (input.generate !== true) {
    return current;
  }
  if (!input.model || !first_user_text) {
    await log_session_title_diagnostic({
      logger: input.logger,
      session_id: input.session_id,
      level: "debug",
      message: "[agent] session_title.skipped",
      details: {
        reason: !input.model ? "missing_model" : "missing_first_user_text",
        model_label: input.model_label || null,
        message_count: input.messages.length,
      },
    });
    return current;
  }

  const generated_title = await generate_session_title({
    model: input.model,
    session_id: input.session_id,
    model_label: input.model_label,
    first_user_text,
    logger: input.logger,
    signal: input.signal,
    on_model_request_failure: input.on_model_request_failure,
  });
  if (!generated_title) return current;

  if (input.commit_title) return await input.commit_title(generated_title);
  const generated_meta: SessionHistoryMeta = {
    ...(await input.store.read_metadata()),
    title: generated_title,
  };
  await input.store.write_metadata(generated_meta);
  return generated_meta;
}
