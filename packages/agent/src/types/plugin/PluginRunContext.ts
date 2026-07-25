/**
 * Plugin 单次调用的运行上下文。
 *
 * 关键点（中文）
 * - 只暴露 plugin 业务需要的只读 Session 快照。
 * - 不暴露 Executor 内部队列、callback 或 plugin lease。
 * - CLI、HTTP 与 scheduler 等非 Session 调用可能不提供该对象。
 */

/**
 * Plugin action 与 system provider 可读取的 Session 运行快照。
 */
export interface PluginRunContext {
  /** 当前调用所属的 Session 标识。 */
  readonly session_id: string;

  /** 当前调用所属的 turn 标识。 */
  readonly turn_id?: string;

  /** 当前 Agent 绑定的项目根目录。 */
  readonly project_root?: string;

  /** 当前 Session step 已提交生效的 Workspace env 快照。 */
  readonly workspace_env?: Readonly<Record<string, string>>;

  /** 当前 Session step 已提交生效的 instruction 快照。 */
  readonly agent_systems?: readonly string[];

  /** 当前 turn 的取消信号。 */
  readonly abort_signal?: AbortSignal;
}
