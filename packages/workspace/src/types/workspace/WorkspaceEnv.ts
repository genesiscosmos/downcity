/**
 * Workspace 环境变量公共类型。
 *
 * 关键点（中文）
 * - Env 属于项目执行环境，由 Workspace 持有。
 * - Agent 只订阅 Env 变化并在 Session Step 检查点同步。
 */

/** Workspace 环境变量的运行时修改输入。 */
export type WorkspaceEnvPatch = Record<string, string | null | undefined>;

/** Workspace 环境变量变化订阅器。 */
export type WorkspaceEnvSubscriber = (
  /** 本次修改完成后的完整环境变量快照。 */
  env: Readonly<Record<string, string>>,
) => void;

/** 取消 Workspace 环境变量订阅的函数。 */
export type WorkspaceEnvUnsubscribe = () => void;
