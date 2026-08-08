/**
 * SDK Session 标题生成与持久化辅助。
 *
 * 关键点（中文）
 * - session title 是 `meta.json` 顶层字段，列表与详情都以它为准。
 * - title 默认允许为空；只有模型成功生成标题时才会写入。
 * - 当 title 仍为空时，后续执行链路可以再次尝试生成。
 */

import { streamText, type LanguageModel } from "ai";
import type { SessionHistoryMetaV1 } from "@/executor/types/SessionHistoryMeta.js";
import type { SessionRecordV1 } from "@/executor/types/SessionRecords.js";
import { is_session_message_record } from "@/executor/types/SessionRecords.js";
import type { Logger } from "@/utils/logger/Logger.js";
import { normalize_session_title } from "@/session/storage/Metadata.js";
import type { SessionStore } from "@/types/store/SessionStore.js";

const GENERATED_SESSION_TITLE_MAX_CHARS = 24;

/**
 * 标题持久化参数。
 */
export interface EnsureSessionTitleParams {
  /** 当前 Session 的领域持久化入口。 */
  store: SessionStore;

  /**
   * 当前 session_id。
   */
  session_id: string;

  /**
   * 当前 session 已落盘消息。
   */
  messages: SessionRecordV1[];

  /**
   * 可选模型实例；传入时会尝试生成更短标题。
   */
  model?: LanguageModel;

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

  /** 可选的标题提交入口，用于与其他 metadata mutation 串行化。 */
  commit_title?: (title: string) => Promise<SessionHistoryMetaV1>;
}

function truncateTitle(input: string, maxChars: number): string {
  const title = String(input || "").replace(/\s+/g, " ").trim();
  if (!title) return "";
  if (title.length <= maxChars) return title;
  return title.slice(0, maxChars).trimEnd();
}

function extractTextFromMessage(message: SessionRecordV1): string {
  if (!is_session_message_record(message)) return "";
  if (!Array.isArray(message.parts)) return "";
  const texts: string[] = [];
  for (const part of message.parts) {
    if (!part || typeof part !== "object") continue;
    const textPart = part as { type?: unknown; text?: unknown };
    if (textPart.type !== "text" || typeof textPart.text !== "string") continue;
    const text = textPart.text.trim();
    if (!text) continue;
    texts.push(text);
  }
  return texts.join("\n").trim();
}

function resolveFirstUserText(messages: SessionRecordV1[]): string {
  for (const message of messages) {
    if (!is_session_message_record(message)) continue;
    if (message.role !== "user") continue;
    const text = extractTextFromMessage(message);
    if (text) return text;
  }
  return "";
}

function normalizeGeneratedTitle(input: string): string | undefined {
  const firstLine = String(input || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  const title = normalize_session_title(
    String(firstLine || "")
      .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
      .replace(/^标题[:：]\s*/i, "")
      .trim(),
  );
  return title
    ? truncateTitle(title, GENERATED_SESSION_TITLE_MAX_CHARS)
    : undefined;
}

function summarizeTitleError(error: unknown): {
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

async function logSessionTitleDiagnostic(input: {
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

async function generateSessionTitle(input: {
  /**
   * 当前模型实例。
   */
  model: LanguageModel;

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
  firstUserText: string;

  /**
   * 当前 session 运行日志器。
   */
  logger?: Logger;

  /** 标题请求取消信号。 */
  signal?: AbortSignal;
}): Promise<string | undefined> {
  let observedStreamError: unknown;
  try {
    const result = streamText({
      model: input.model,
      system:
        "You generate minimal conversation titles. Output only the title itself, with no explanation and no quotation marks.",
      prompt: [
        "Generate a short conversation title from the first user message below.",
        "Requirements: 3 to 12 Chinese characters or 2 to 6 English words; no period; no prefix.",
        "",
        input.firstUserText,
      ].join("\n"),
      onError: ({ error }) => {
        observedStreamError = error;
      },
      abortSignal: input.signal,
    });
    const text = await result.text;
    const generatedTitle = normalizeGeneratedTitle(text);
    if (!generatedTitle) {
      await logSessionTitleDiagnostic({
        logger: input.logger,
        session_id: input.session_id,
        level: "warn",
        message: "[agent] session_title.empty",
        details: {
          model_label: input.model_label || null,
          firstUserTextLength: input.firstUserText.length,
          rawTitleLength: String(text || "").length,
        },
      });
    }
    return generatedTitle;
  } catch (error) {
    const effectiveError = observedStreamError || error;
    await logSessionTitleDiagnostic({
      logger: input.logger,
      session_id: input.session_id,
      level: "warn",
      message: "[agent] session_title.generate_failed",
      details: {
        model_label: input.model_label || null,
        firstUserTextLength: input.firstUserText.length,
        ...summarizeTitleError(effectiveError),
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
): Promise<SessionHistoryMetaV1> {
  const current = await input.store.read_metadata();
  if (current.title) return current;

  const firstUserText = resolveFirstUserText(input.messages);
  if (input.generate !== true) {
    return current;
  }
  if (!input.model || !firstUserText) {
    await logSessionTitleDiagnostic({
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

  const generatedTitle = await generateSessionTitle({
    model: input.model,
    session_id: input.session_id,
    model_label: input.model_label,
    firstUserText,
    logger: input.logger,
    signal: input.signal,
  });
  if (!generatedTitle) return current;

  if (input.commit_title) return await input.commit_title(generatedTitle);
  const generatedMeta: SessionHistoryMetaV1 = {
    ...(await input.store.read_metadata()),
    title: generatedTitle,
  };
  await input.store.write_metadata(generatedMeta);
  return generatedMeta;
}
