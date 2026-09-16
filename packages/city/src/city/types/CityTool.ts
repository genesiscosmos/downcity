/**
 * City Tool 契约类型。
 *
 * 关键点（中文）
 * - `city` 是 Agent 查询运行时事实的唯一只读入口，按 namespace 组织动作。
 * - 这里只描述注册、分发、可见性与结果信封，不含任何具体 namespace 的数据结构。
 * - 动作参数与返回结构由各自 provider 声明，模型侧描述全部从注册表派生。
 */

import type { Agent } from "@downcity/agent";
import type { WorkspaceRuntime } from "@/workspace/index.js";
import type { WorkspaceSandboxSnapshot } from "@downcity/type/shell";

/** city tool 动作的读写性质。 */
export type CityToolCapability = "read" | "write";

/** city tool namespace 的敏感级别。 */
export type CityToolSensitivity = "public" | "internal" | "sensitive";

/** city tool 失败时的机器可读错误码。 */
export type CityToolErrorCode =
  | "not_found"
  | "forbidden"
  | "unsupported_action"
  | "invalid_args"
  | "sandbox_denied"
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

/** 单个动作参数的声明，用于模型侧描述与运行时取值。 */
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

/** 单个动作的声明。 */
export interface CityToolActionSpec {
  /** 动作名，snaker。 */
  readonly action: string;
  /** 动作用途的一行摘要，进入模型侧描述。 */
  readonly summary: string;
  /** 动作参数声明。 */
  readonly args: readonly CityToolArgSpec[];
  /** 返回结构说明，进入模型侧描述。 */
  readonly returns: string;
  /** 读写性质；第一期全部为 read。 */
  readonly capability: CityToolCapability;
  /** 敏感级别；决定是否参与默认可见集合。 */
  readonly sensitivity: CityToolSensitivity;
}

/** 单次动作调用输入。 */
export interface CityToolActionCall {
  /** 目标动作名。 */
  readonly action: string;
  /** 已经过 provider 取值校验的参数对象。 */
  readonly args: Record<string, unknown>;
  /** 本次调用可见的运行时事实。 */
  readonly context: CityToolContext;
}

/**
 * 一个 namespace 的实现契约。
 *
 * 关键点（中文）
 * - provider 只实现自己声明的动作，不感知可见性判定与结果信封。
 * - 执行成功直接返回数据，失败抛出 CityToolRuntimeError。
 */
export interface CityToolNamespaceProvider {
  /** namespace 名，snaker。 */
  readonly namespace: string;
  /** namespace 用途的一行摘要，进入模型侧描述。 */
  readonly summary: string;
  /** 动作清单。 */
  readonly actions: readonly CityToolActionSpec[];
  /** 执行入口。 */
  handle(call: CityToolActionCall): Promise<unknown>;
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

/**
 * City tool 的宿主装配能力。
 *
 * 关键点（中文）
 * - 配置放在 City 级 `~/.downcity/plugins/city/config.toml`，路径约定属于宿主装配层。
 * - City 只调用读取函数，不感知配置文件格式、位置与是否存在。
 */
export interface CityToolHost {
  /** 读取 City 级 city tool 配置；未配置时返回空对象。 */
  readonly read_config: () => Record<string, unknown>;
}

/** City 级 city tool 可见性策略。 */
export interface CityToolPolicy {
  /** 默认可见的 namespace 名称；未配置时取全部非敏感 namespace。 */
  readonly defaults: readonly string[];
  /** 针对单个 Agent 的可见性覆盖。 */
  readonly agents: readonly CityToolAgentPolicy[];
}

/** 单个 Agent 的 namespace 可见性覆盖。 */
export interface CityToolAgentPolicy {
  /** 目标 Agent 标识。 */
  readonly agent_id: string;
  /** 显式允许的 namespace；null 表示继承默认集合。 */
  readonly allow: readonly string[] | null;
  /** 显式禁止的 namespace，优先级高于 allow。 */
  readonly deny: readonly string[];
}
