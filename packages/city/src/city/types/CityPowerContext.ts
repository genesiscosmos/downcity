/**
 * City Power 执行上下文与动作错误契约。
 *
 * 关键点（中文）
 * - `city` 是 City 自有的 power，动作仍然需要「我现在是谁、在哪」这类事实，
 *   以及 City 内部可见的 Agent / Workspace 快照。
 * - 这些字段由 City 在构造 `CityPower` 时注入，不放进通用 `PowerContext`，
 *   因此外部 power 拿不到 City 内部索引。
 * - 上下文是即时投影的快照，动作不能借它改回 City 状态。
 */

import type { Agent } from "@downcity/agent";
import type { SessionInteractionPort } from "@downcity/type";
import type { WorkspaceRuntime, FileSystem } from "@/workspace/index.js";
import type { WorkspaceSandboxSnapshot } from "@downcity/type/shell";
import type { Embassy } from "@downcity/federation";

/** city 动作可预期的失败码；用于区分模型可自行纠正与不可重试的情况。 */
export type CityActionErrorCode =
  | "not_found"
  | "unsupported_action"
  | "invalid_args"
  | "internal";

/**
 * 单次 city 动作的执行上下文。
 *
 * 关键点（中文）
 * - 一次调用只暴露两类东西：当前身份与视野（只读事实），以及当前动作可用的资源。
 * - 资源按动作组隔离：`files` 指向该组在当前 Agent 下的私有目录，不跨组共享。
 */
export interface CityPowerContext {
  /** 当前被调用的动作 id，点号形式，例如 `env.get`。 */
  readonly action_id: string;

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
  /** 当前 Workspace 的宿主绝对路径；本地相对路径以此为根。 */
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

  /** 当前动作组在当前 Agent 范围内的私有文件端口。 */
  readonly files: FileSystem;
  /** City 的 Federation Embassy；未配置时为空。 */
  readonly embassy?: Embassy;
  /** 当前 Turn 的取消信号。 */
  readonly abort_signal?: AbortSignal;
  /** 当前调用的稳定标识，用于归属审批与交互。 */
  readonly call_id: string;
  /**
   * 当前调用的交互入口。
   *
   * 关键点（中文）
   * - 所有入口都提供它；无 Session 的入口提供拒绝式实现。
   * - 声明 `approval` 的动作由基类通过 `interactions.approval` 统一请求。
   */
  readonly interactions: SessionInteractionPort;
}
