/**
 * Session 状态读取协议。
 *
 * 职责说明（中文）
 * - Session 的持久化配置与当前运行时实例都可以通过一个带泛型的 `get(key)` 读取。
 * - 两类值明确分开：
 *   1. 持久化字段：可序列化，随 Session 落盘，跨进程恢复后仍可读（如 `workspace_id`、`title`）。
 *   2. 运行时实例：只存在于当前进程，由宿主在创建或打开 Session 时注入（如 `workspace`、`model`）。
 *
 * 关键点（中文）
 * - 不提供 `get_workspace()` 这类专用方法：新增状态只需扩展这里的键，不需要新增 API。
 * - 键名即语义，`workspace_id` 是持久化标识，`workspace` 是运行时实例，两者不可互相推导。
 */

import type { ModelClient, SessionApprovalMode, WorkspaceRuntime } from "@downcity/type";

/**
 * `session.get(key)` 支持的键到值类型的映射。
 *
 * 两类值明确分开：
 * 1. 持久化字段：可序列化，随 Session 落盘，跨进程恢复后仍可读。
 * 2. 运行时实例：只存在于当前进程，由宿主在创建或打开 Session 时注入。
 */
export interface AgentSessionStateValues {
  /** 当前 Session 正在使用的 Workspace 实例；未注入或已脱离时为 undefined。 */
  workspace: WorkspaceRuntime | undefined;

  /** 当前 Session 持久化的 Workspace 标识；没有项目上下文时为 undefined。 */
  workspace_id: string | undefined;

  /** 当前 Session 使用的运行时模型实例。 */
  model: ModelClient | undefined;

  /** 当前模型的轻量可读标签。 */
  model_label: string | undefined;

  /** 当前模型声明的上下文窗口长度，单位为 token。 */
  model_context_window: number | undefined;

  /** 当前 Session 已接受的审批模式。 */
  approval_mode: SessionApprovalMode;

  /** 当前 Session 的用户可见标题；未生成时为空。 */
  title: string | undefined;

  /** 当前 Session 的参考时区，IANA 名称。 */
  timezone: string;

  /** 当前 Session 首次创建时间戳（ms）。 */
  created_at: number;

  /** 当前 Session 最近一次更新时间戳（ms）；尚未写入时为 undefined。 */
  updated_at: number | undefined;
}

/** `session.get(key)` 支持的键。 */
export type AgentSessionStateKey = keyof AgentSessionStateValues;

/**
 * 远程 Session 可读取的键：只包括可序列化的持久化字段。
 *
 * 关键点（中文）：只包括能从远程详情快照直接得到的可序列化字段；进程内实例
 * （`workspace`、`model`）与需要单独查询的状态（`approval_mode`）不在其中。
 */
export type RemoteSessionStateKey = Exclude<
  AgentSessionStateKey,
  "workspace" | "model" | "model_context_window" | "approval_mode"
>;

/** 远程 `session.get(key)` 支持的值。 */
export type RemoteSessionStateValues = Pick<
  AgentSessionStateValues,
  RemoteSessionStateKey
>;
