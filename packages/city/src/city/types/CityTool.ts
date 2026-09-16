/**
 * City Tool 契约类型。
 *
 * 关键点（中文）
 * - `city` 是 Agent 查询运行时事实的唯一只读入口，按 namespace 组织动作。
 * - 这里只描述参数声明、运行时事实与结果信封，不含具体 namespace 的数据结构。
 * - namespace 与动作由 `city/tool/namespaces/` 下的类自描述，模型侧说明从对象派生。
 * - 可用性与 Plugin 同一口径：City 注册什么，每个 Agent 就能用什么。
 */

import type { Agent } from "@downcity/agent";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type { WorkspaceSandboxSnapshot } from "@downcity/type/shell";

/** city tool 动作的读写性质。 */
export type CityToolCapability = "read" | "write";

/** city tool 失败时的机器可读错误码。 */
export type CityToolErrorCode =
  | "not_found"
  | "unsupported_action"
  | "invalid_args"
  | "internal";

/** city tool 返回给模型的统一信封，避免每个 namespace 各自约定成败表达。 */
export interface CityToolResult {
  /** 本次调用是否成功。 */
  readonly ok: boolean;
  /** 被调用的 namespace；索引调用为 null。 */
  readonly namespace: string | null;
  /** 被调用的 action；索引调用或 namespace 索引调用为 null。 */
  readonly action: string | null;
  /** 成功时的数据；失败为 null。 */
  readonly data: unknown;
  /** 失败时的结构化错误；成功为 null。 */
  readonly error: CityToolError | null;
}

/** city tool 失败时的结构化错误。 */
export interface CityToolError {
  /** 机器可读错误码。 */
  readonly code: CityToolErrorCode;
  /** 面向模型的一句话说明。 */
  readonly message: string;
  /** 便于定位的补充信息；没有时为 null。 */
  readonly detail: Record<string, unknown> | null;
}

/** 单个动作参数的声明，同时驱动模型侧说明与运行时校验。 */
export interface CityToolArgSpec {
  /** 参数名，snaker。 */
  readonly name: string;
  /** 参数类型；数组只允许字符串数组。 */
  readonly type: "string" | "number" | "boolean" | "string_array";
  /** 是否必填。 */
  readonly required: boolean;
  /** 参数用途的一行说明。 */
  readonly description: string;
}

/** 单次 city tool 调用可见的运行时事实。 */
export interface CityToolContext {
  /** 当前 Agent 标识。 */
  readonly agent_id: string;
  /** 当前 Agent 用户可见名称。 */
  readonly agent_name: string;
  /** 当前 Session 标识；无会话场景为 null。 */
  readonly session_id: string | null;
  /** 当前 Turn 标识；无会话场景为 null。 */
  readonly turn_id: string | null;
  /** 当前 Workspace 标识。 */
  readonly workspace_id: string;
  /** 当前 Workspace 用户可见名称。 */
  readonly workspace_name: string;
  /** 当前 Workspace 的宿主绝对路径，也是沙箱内工作目录的来源。 */
  readonly workspace_path: string;
  /** 当前 Agent 默认模型标识；未配置为 null。 */
  readonly model_id: string | null;
  /** 运行时参考时区，IANA 名称。 */
  readonly timezone: string;
  /** 本次调用时刻。 */
  readonly now: Date;
  /** 当前 Workspace 沙箱自省快照；Workspace 未提供 Shell 时为 null。 */
  readonly sandbox: WorkspaceSandboxSnapshot | null;
  /** 当前 City 可见的 Agent 快照。 */
  readonly agents: readonly Agent[];
  /** 当前 City 可见的 Workspace 快照。 */
  readonly workspaces: readonly WorkspaceRuntime[];
}
