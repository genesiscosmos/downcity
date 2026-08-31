/** Task Plugin 工作区与宿主 main 之间的 JSON 协议。 */

/** Task 工作区中的 Agent 摘要。 */
export interface TaskMainviewAgent {
  /** Agent 的稳定 ID。 */
  readonly agent_id: string;
}

/** Task 工作区中的 Workspace 摘要。 */
export interface TaskMainviewWorkspace {
  /** Workspace 的稳定 ID。 */
  readonly workspace_id: string;

  /** Workspace 的用户可见名称。 */
  readonly name: string;
}

/** Task 工作区展示的一条任务定义。 */
export interface TaskMainviewItem {
  /** Task 的稳定标题。 */
  readonly title: string;

  /** Task 的用途说明。 */
  readonly description: string;

  /** Task 的完整执行正文。 */
  readonly body?: string;

  /** Task 的触发条件。 */
  readonly when: string;

  /** Task 当前状态。 */
  readonly status: string;

  /** Task 执行类型。 */
  readonly kind?: "agent" | "script";

  /** Task 绑定的 Session ID。 */
  readonly session_id: string;

  /** 最近一次运行时间。 */
  readonly last_run_at?: string;
}

/** Task 工作区一次读取返回的完整快照。 */
export interface TaskMainviewSnapshot {
  /** 当前可管理的 Agent。 */
  readonly agents: TaskMainviewAgent[];

  /** 当前可提供执行上下文的 Workspace。 */
  readonly workspaces: TaskMainviewWorkspace[];

  /** 当前 Agent 的 Task；尚未选择上下文时为空。 */
  readonly tasks: TaskMainviewItem[];
}

/** Task 工作区选择 Agent 与 Workspace 的输入。 */
export interface TaskMainviewContextInput {
  /** 目标 Agent ID。 */
  readonly agent_id?: string;

  /** 执行上下文 Workspace ID。 */
  readonly workspace_id?: string;
}
