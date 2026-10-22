/**
 * Session 来源元数据。
 *
 * Session 始终归 Agent 所有。来源拆成两层，各自承担不同职责：
 *
 * - `category` 是顶层分类，只有 `chat` 与 `work` 两个值，同时承担物理存储分区
 *   与身份作用域的职责。
 * - `type` 是具体角色，用于能力判定与语义表达；已知角色有六个，调用方也可以
 *   定义自己的稳定角色。
 *
 * 关键点（中文）
 * - `chat` 类是对话会话：Agent 主对话、外部聊天、群聊、浏览器扩展。
 * - `work` 类是干活会话：普通工作会话、任务会话。
 * - `agent` 角色的 `session_id` 等于 Agent 的 `id`：会话由它属于谁来标识。
 * - `session_id` 只在同一 `category` 内唯一，不跨分类唯一。
 */

import type { JsonValue } from "../json/Json.js";

/** 对话类分类：与用户或外部渠道对话的会话。 */
export const SESSION_ORIGIN_CATEGORY_CHAT = "chat";

/** 干活类分类：执行具体工作的会话。 */
export const SESSION_ORIGIN_CATEGORY_WORK = "work";

/** Agent 自己那条会话的角色。 */
export const SESSION_ORIGIN_TYPE_AGENT = "agent";

/** 每个外部聊天独有、归绑定 Agent 所有的会话角色。 */
export const SESSION_ORIGIN_TYPE_CHANNEL = "channel";

/** 群聊成员会话的角色。 */
export const SESSION_ORIGIN_TYPE_GROUP = "group";

/** 浏览器扩展会话的角色。 */
export const SESSION_ORIGIN_TYPE_CHROME = "chrome";

/** 普通工作会话的角色，也是未指定角色时的默认值。 */
export const SESSION_ORIGIN_TYPE_WORK = "work";

/** 任务会话的角色。 */
export const SESSION_ORIGIN_TYPE_TASK = "task";

/**
 * 派发深度上限。
 *
 * 根会话（主会话、外部聊天、任务会话）深度为 0，每派发一层加 1；
 * 达到上限的会话不能再派发，避免失控嵌套。
 */
export const SESSION_DELEGATION_MAX_DEPTH = 3;

/** 顶层分类的封闭取值。 */
export type SessionOriginCategory =
  | typeof SESSION_ORIGIN_CATEGORY_CHAT
  | typeof SESSION_ORIGIN_CATEGORY_WORK;

/**
 * 已知角色到分类的映射。
 *
 * 这是「角色归属哪个分类」的唯一权威来源；调用方自定义角色不受此表约束，
 * 但必须在创建时显式给出 `category`。
 */
const ORIGIN_CATEGORY_BY_TYPE: Readonly<Record<string, SessionOriginCategory>> = Object.freeze({
  [SESSION_ORIGIN_TYPE_AGENT]: SESSION_ORIGIN_CATEGORY_CHAT,
  [SESSION_ORIGIN_TYPE_CHANNEL]: SESSION_ORIGIN_CATEGORY_CHAT,
  [SESSION_ORIGIN_TYPE_GROUP]: SESSION_ORIGIN_CATEGORY_CHAT,
  [SESSION_ORIGIN_TYPE_CHROME]: SESSION_ORIGIN_CATEGORY_CHAT,
  [SESSION_ORIGIN_TYPE_WORK]: SESSION_ORIGIN_CATEGORY_WORK,
  [SESSION_ORIGIN_TYPE_TASK]: SESSION_ORIGIN_CATEGORY_WORK,
});

/** Session 的创建来源。 */
export type SessionOrigin = {
  /**
   * 顶层分类，同时作为 Session Store 的一级分区名。
   *
   * 取值封闭为 `chat` / `work`；它决定会话的存储位置与身份作用域，不参与
   * 细粒度能力判定。
   */
  readonly category: SessionOriginCategory;
  /**
   * 具体角色。
   *
   * 已知角色见本模块导出的常量；调用方也可以声明自己的稳定角色，
   * 此时必须同时给出正确的 `category`。
   */
  readonly type: string;
  /**
   * 创建方附加的可序列化来源信息。
   *
   * 除 `category` 与 `type` 外的字段由创建方拥有、校验和解释，Agent 核心
   * 只负责完整持久化。
   */
  readonly [key: string]: JsonValue;
};

/** 规范化一个 Session 来源分类。 */
export function normalize_session_origin_category(input: unknown): SessionOriginCategory {
  const category = typeof input === "string" ? input.trim() : "";
  if (
    category === SESSION_ORIGIN_CATEGORY_CHAT
    || category === SESSION_ORIGIN_CATEGORY_WORK
  ) {
    return category;
  }
  throw new Error(
    `Session origin.category requires "${SESSION_ORIGIN_CATEGORY_CHAT}" or "${SESSION_ORIGIN_CATEGORY_WORK}"`,
  );
}

/** 规范化一个 Session 来源角色。 */
export function normalize_session_origin_type(input: unknown): string {
  const origin_type = typeof input === "string" ? input.trim() : "";
  if (!origin_type) throw new Error("Session origin.type requires a non-empty string");
  return origin_type;
}

/** 返回已知角色所属的分类；未知角色返回 undefined。 */
export function resolve_origin_category(origin_type: string): SessionOriginCategory | undefined {
  return ORIGIN_CATEGORY_BY_TYPE[normalize_session_origin_type(origin_type)];
}

/**
 * 解析来源分类：优先使用显式声明，缺省时按已知角色推断。
 *
 * 未知角色没有可推断的分类，直接失败并要求调用方显式传入，避免把自定义角色
 * 静默塞进某个分类。
 */
function resolve_origin_category_input(
  origin: Record<string, JsonValue>,
  origin_type: string,
): SessionOriginCategory {
  const declared = origin.category === undefined
    ? undefined
    : normalize_session_origin_category(origin.category);
  const inferred = ORIGIN_CATEGORY_BY_TYPE[origin_type];
  if (declared && inferred && declared !== inferred) {
    throw new Error(
      `Session origin.category "${declared}" does not match role "${origin_type}"`,
    );
  }
  const resolved = declared ?? inferred;
  if (!resolved) {
    throw new Error(
      `Session origin.type "${origin_type}" has no known category; pass origin.category explicitly`,
    );
  }
  return resolved;
}

/** 规范化创建输入；未指定来源时使用默认工作会话。 */
export function normalize_session_origin(input?: SessionOrigin): SessionOrigin {
  const source = input ?? {
    category: SESSION_ORIGIN_CATEGORY_WORK,
    type: SESSION_ORIGIN_TYPE_WORK,
  };
  let serialized: unknown;
  try {
    serialized = JSON.parse(JSON.stringify(source));
  } catch {
    throw new Error("Session origin must be a JSON object");
  }
  if (!serialized || typeof serialized !== "object" || Array.isArray(serialized)) {
    throw new Error("Session origin must be a JSON object");
  }
  const origin = serialized as Record<string, JsonValue>;
  const origin_type = normalize_session_origin_type(origin.type);
  return {
    ...origin,
    category: resolve_origin_category_input(origin, origin_type),
    type: origin_type,
  };
}

/**
 * 读取一个来源的派发深度。
 *
 * 参数用索引签名而不是具体字段：来源在各包里有各自的镜像类型，
 * 它们共有的只是「可携带任意 JSON 字段」这一点。
 *
 * 根会话（主会话、外部聊天、任务会话）没有该字段，按 0 算；字段缺失或非法值
 * 都回退到 0，避免历史数据阻断派发。
 */
export function read_session_delegation_depth(
  origin: { readonly [key: string]: unknown } | undefined,
): number {
  const depth = origin?.delegation_depth;
  return typeof depth === "number" && Number.isInteger(depth) && depth >= 0 ? depth : 0;
}

/**
 * 判断一个来源是否允许派发其他会话。
 *
 * `session` 能力所有动作（开始、继续、观察、答复、停止、归档）共用这一条判据。
 * 限制按派发深度而非来源分类：任何会话都能派发，但分层数到了上限就停止，
 * 避免失控嵌套。
 */
export function can_delegate_work(
  origin: { readonly [key: string]: unknown } | undefined,
): boolean {
  return read_session_delegation_depth(origin) < SESSION_DELEGATION_MAX_DEPTH;
}

/** 判断一个来源是否表示 Agent 自己的会话。 */
export function is_agent_session_origin(
  origin: { type?: string } | undefined,
): boolean {
  return String(origin?.type || "").trim() === SESSION_ORIGIN_TYPE_AGENT;
}

/** 恢复 Metadata，并校验来源与目标物理分区一致。 */
export function restore_session_origin(
  input: unknown,
  expected_category: string,
): SessionOrigin {
  if (!input) throw new Error("Session metadata requires origin");
  const origin = normalize_session_origin(input as SessionOrigin);
  const normalized_expected = normalize_session_origin_category(expected_category);
  if (origin.category !== normalized_expected) {
    throw new Error(
      `Session origin "${origin.category}" does not match storage partition "${normalized_expected}"`,
    );
  }
  return origin;
}
