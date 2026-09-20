/**
 * city tool 各 method 的数据契约。
 *
 * 关键点（中文）
 * - 只声明当前 harness 真实持有的事实；没有事实源的字段不进入契约。
 * - 所有字段名使用 snaker，并与 `packages/city/src/city/tool/methods/` 下的实现一一对应。
 * - image 与 sound 的领域类型跟各自的 method 放在一起，不集中到这里。
 */

import type {
  SandboxNetworkMode,
  SandboxReadScope,
  WorkspaceSandboxMount,
} from "@downcity/type/shell";

/** `env.get` 返回的当前执行环境。 */
export interface CityToolEnv {
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
  /** 本次查询时刻，带时区的 ISO8601 字符串。 */
  readonly now: string;
  /** 当前本地日期，YYYY-MM-DD，便于直接使用。 */
  readonly current_date: string;
}

/** `sandbox.get` 返回的当前沙箱事实。 */
export interface CityToolSandbox {
  /** 当前 Workspace 是否提供命令执行能力。 */
  readonly available: boolean;
  /** 执行后端标识，例如 native；不可用时为 null。 */
  readonly backend: string | null;
  /** 沙箱实例标识，用于跨进程定位同一个 Sandbox；不可用时为 null。 */
  readonly sandbox_id: string | null;
  /** 沙箱内的工作目录；不可用时为 null。 */
  readonly workdir: string | null;
  /** 当前语义授权给沙箱的宿主目录；不枚举后端派生的系统规则。 */
  readonly mounts: readonly WorkspaceSandboxMount[];
  /** 当前生效的出网策略；不可用时为 null。 */
  readonly network: SandboxNetworkMode | null;
  /** 当前生效的读取范围模型；不可用时为 null。 */
  readonly read_scope: SandboxReadScope | null;
  /** 当前允许写入的宿主根路径；不可用时为空数组。 */
  readonly writable_roots: readonly string[];
  /** 当前强制拒绝读取的宿主路径；不可用时为空数组。 */
  readonly denied_read_paths: readonly string[];
  /** 当前生效策略的稳定摘要，用于审计还原与变更比对；不可用时为 null。 */
  readonly policy_digest: string | null;
  /** 沙箱状态是否跨轮持久。 */
  readonly persistent: boolean;
}

/** `sandbox.explain_path` 的路径判定结果码。 */
export type CityToolPathReasonCode =
  /** 请求的意图在生效边界内。 */
  | "allowed"
  /** 路径在 Workspace 与授权目录之外。 */
  | "outside_workspace"
  /** 路径命中强制读取排除列表。 */
  | "read_denied"
  /** 路径可读但不在写入白名单内。 */
  | "write_denied"
  /** 路径本身非法。 */
  | "invalid_path";

/** `sandbox.explain_path` 支持的访问意图。 */
export type CityToolPathIntent = "read" | "write";

/** `sandbox.explain_path` 返回的路径判定结果。 */
export interface CityToolPathExplanation {
  /** 是否允许该意图的访问。 */
  readonly allowed: boolean;
  /** 归一化后的宿主绝对路径；输入为沙箱内路径时会先映射回宿主路径。 */
  readonly resolved_path: string;
  /** 请求判定的访问意图。 */
  readonly intent: CityToolPathIntent;
  /** 允许访问时给出它落在哪个挂载点内，否则为 null。 */
  readonly matched_mount: WorkspaceSandboxMount | null;
  /** 机器可读判定结果码。 */
  readonly reason_code: CityToolPathReasonCode;
  /** 给模型看的一句话解释。 */
  readonly reason: string;
}

/** `workspaces.list` 与 `workspaces.get` 返回的单个 Workspace 摘要。 */
export interface CityToolWorkspaceSummary {
  /** Workspace 标识。 */
  readonly workspace_id: string;
  /** Workspace 用户可见名称。 */
  readonly name: string;
  /** Workspace 的宿主绝对路径。 */
  readonly path: string;
  /** 是否是当前 Session 所在的 Workspace。 */
  readonly is_current: boolean;
}

/** `agent.list` 与 `agent.get` 返回的单个 Agent 摘要。 */
export interface CityToolAgentSummary {
  /** Agent 标识。 */
  readonly agent_id: string;
  /** Agent 用户可见名称。 */
  readonly name: string;
  /** Agent 默认模型标识；未配置为 null。 */
  readonly model_id: string | null;
  /** 是否是当前正在运行的 Agent。 */
  readonly is_current: boolean;
}

/** `usage.get` 支持的查询范围。 */
export type CityToolUsageScope = "today" | "month" | "total";
