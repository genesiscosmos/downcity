/**
 * Plugin action 与 system provider 可读取的执行快照。
 *
 * Session 调用时，该对象是当前 Turn 的只读 Plugin 投影；CLI、HTTP 与
 * scheduler 等非 Session 调用也可以提供自己的调用快照或完全缺省。
 */

export interface PluginExecutionContext {
  /** 当前调用所属的 Session 标识；非 Session 调用可以缺省。 */
  readonly session_id?: string;

  /** 当前调用所属的 Turn 标识。 */
  readonly turn_id?: string;

  /** 当前 Agent 绑定的项目根目录。 */
  readonly project_root?: string;

  /** 当前 Session Step 已提交生效的 Workspace env 快照。 */
  readonly workspace_env?: Readonly<Record<string, string>>;

  /** 当前 Session Step 已提交生效的 instruction 快照。 */
  readonly agent_systems?: readonly string[];

  /** 当前 Turn 的取消信号。 */
  readonly abort_signal?: AbortSignal;

  /** 当前 Action 调用标识；仅 Action 执行时存在。 */
  readonly call_id?: string;
}
