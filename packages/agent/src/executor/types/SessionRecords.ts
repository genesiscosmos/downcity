/**
 * SessionRecord 类型定义。
 *
 * 关键点（中文）
 * - SessionMessage 是唯一持久化事实，record 只作为 Executor、Composer 和旧 UI 的内部投影。
 * - message record 继续使用 AI SDK `UIMessage`，action record 不属于 LLM 输入。
 * - 这些类型不定义 canonical Session 存储结构。
 */

import type { UIMessage } from "ai";
import type { JsonObject } from "@/types/common/Json.js";

/**
 * Session message record 类别。
 *
 * 关键点（中文）
 * - User / Assistant SessionMessage 会在执行边界临时投影为 message record。
 * - Compact Summary 同样投影为一条内部 `assistant` record。
 * - action 只用于 UI timeline，不进入 LLM 输入
 */
export type SessionMessageKind = "normal" | "summary";

/**
 * Session 消息来源类型。
 *
 * 说明（中文）
 * - `ingress`：外部输入写入的 user 消息。
 * - `egress`：模型或 agent 输出写入的 assistant 消息。
 * - `compact`：由 compact 过程生成的摘要消息。
 */
export type SessionMessageSource =
  | "ingress"
  | "egress"
  | "compact";

/**
 * 入站消息细分类型。
 *
 * 说明（中文）
 * - 当前仅保留 `exec`，表示这条入站消息可触发一次 session 执行。
 */
export type SessionIngressKind = "exec";

/**
 * 摘要消息对应的原始消息范围。
 */
export type SessionMessageSourceRangeV1 = {
  /** 起始消息 ID。 */
  from_id: string;
  /** 结束消息 ID。 */
  to_id: string;
  /** 被覆盖的原始消息数量。 */
  count: number;
};

/**
 * Session 消息元信息。
 */
export type SessionMetadataV1 = {
  /** 元信息 schema 版本号。 */
  v: 1;
  /** 当前消息写入时的毫秒时间戳。 */
  ts: number;
  /** 当前消息所属的 session ID。 */
  session_id: string;
  /** 当前消息所属 turn。 */
  turn_id?: string;
  /** 当前消息是普通消息还是摘要消息。 */
  kind?: SessionMessageKind;
  /** 当前消息来自入站、出站还是 compact。 */
  source?: SessionMessageSource;
  /** compact 摘要对应的 archive 文件 ID，用于用户历史按层读取更早消息。 */
  archive_id?: string;
  /** compact 摘要所覆盖的原始消息范围。 */
  source_range?: SessionMessageSourceRangeV1;
  /**
   * 扩展元信息。
   *
   * 约定（中文）
   * - 对 `source=ingress` 的 user 消息，可选写入 `extra.ingressKind`：
   *   - `exec`：可触发 Session 执行的输入
   */
  extra?: JsonObject;
};

/**
 * 大模型可消费的 Session message record。
 */
export type SessionMessageRecordV1 = UIMessage<SessionMetadataV1>;

/**
 * Session action 当前状态。
 */
export type SessionActionStateV1 = "running" | "completed" | "failed";

/**
 * action record 元信息。
 */
export type SessionActionMetadataV1 = {
  /** 元信息 schema 版本号。 */
  v: 1;
  /** 当前 action 写入时的毫秒时间戳。 */
  ts: number;
  /** 当前 action 所属的 session ID。 */
  session_id: string;
  /** 当前 action 关联的 turn 标识。 */
  turn_id?: string;
};

/**
 * action 类型的 Session record 结构。
 *
 * 关键点（中文）
 * - `action` 不是 AI SDK 原生 message record。
 * - 它只存在于 session records 与前端 timeline，进入 LLM 前必须过滤。
 */
export type SessionActionRecordV1 = {
  /** record 类型固定为 `action`。 */
  type: "action";
  /** 同一个 action 生命周期内稳定复用的 ID。 */
  id: string;
  /** 当前 action 标题。 */
  title: string;
  /** 当前 action 描述。 */
  description?: string;
  /** 当前 action 状态。 */
  state: SessionActionStateV1;
  /** action 元信息。 */
  metadata: SessionActionMetadataV1;
};

/**
 * 构造 action record 的输入结构。
 */
export type SessionActionRecordInputV1 = {
  /** 同一个 action 生命周期内稳定复用的 ID。 */
  id?: string;
  /** 当前 action 标题。 */
  title: string;
  /** 当前 action 描述。 */
  description?: string;
  /** 当前 action 状态。 */
  state: SessionActionStateV1;
  /** 当前 action 关联的 turn 标识。 */
  turn_id?: string;
  /** 可选 action 元信息覆盖。 */
  metadata?: Partial<SessionActionMetadataV1>;
};

/**
 * Session 持久化 record 结构。
 *
 * 说明（中文）
 * - message record 是可进入 LLM 的 record。
 * - action record 是只给前端展示的 record，组装模型输入前必须过滤。
 */
export type SessionRecordV1 = SessionMessageRecordV1 | SessionActionRecordV1;

/**
 * user 角色的 Session message record。
 */
export type SessionUserMessageV1 = SessionMessageRecordV1 & {
  /** 消息角色固定为 `user`。 */
  role: "user";
};

/**
 * 判断一条 record 是否为 action record。
 */
export function is_session_action_record(
  message: SessionRecordV1 | null | undefined,
): message is SessionActionRecordV1 {
  if (!message || typeof message !== "object") return false;
  return (message as { type?: unknown }).type === "action";
}

/**
 * 从订阅事件构造 action record。
 */
export function to_session_action_record(
  action: SessionActionRecordInputV1 | SessionActionRecordV1,
  session_id: string,
): SessionActionRecordV1 {
  const title = String(action.title || "").trim() || "Action";
  const description = String(action.description || "").trim();
  const id = String(action.id || "").trim() || `action:${session_id}:${Date.now()}`;
  const metadata =
    "metadata" in action && action.metadata && typeof action.metadata === "object"
      ? action.metadata
      : {};
  const turn_id =
    String(metadata.turn_id || "").trim() ||
    ("turn_id" in action ? String(action.turn_id || "").trim() : "");
  return {
    type: "action",
    id,
    title,
    ...(description ? { description } : {}),
    state: action.state,
    metadata: {
      v: 1,
      ts: typeof metadata.ts === "number" ? metadata.ts : Date.now(),
      session_id: String(metadata.session_id || "").trim() || session_id,
      ...(turn_id ? { turn_id: turn_id } : {}),
    },
  };
}

/**
 * 判断一条 record 是否为大模型可消费的 message record。
 */
export function is_session_message_record(
  message: SessionRecordV1 | null | undefined,
): message is SessionMessageRecordV1 {
  if (!message || typeof message !== "object") return false;
  return !is_session_action_record(message);
}
