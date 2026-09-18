/**
 * City 跨包最小运行协议。
 *
 * City 是 Agent 的可选组合根。Agent 只依赖这份能力投影，不依赖具体 City package，
 * 也不理解 Power、Transport 或其他 City 内部实现。
 */

import type { StorageProvider, WorkspaceRuntime } from "../../workspace.js";
import type { RuntimeTool } from "../tool/index.js";
import type { SessionHookRuntime } from "../session/SessionHook.js";

/** Agent 加入 City 后可以使用的最小 City 运行能力。 */
export interface CityRuntime {
  /** City 为 Agent 私有运行数据提供的底层存储。 */
  readonly storage: StorageProvider;

  /** City 当前持有的 Workspace 查询入口。 */
  readonly workspaces: {
    /** 按稳定 ID 读取 Workspace；不存在或正在移除时返回 null。 */
    get(workspace_id: string): WorkspaceRuntime | null;
  };

  /** 等待 Agent 执行依赖的 City 能力完成初始化。 */
  ensure_ready(): Promise<void>;

  /** 返回当前 Agent/Workspace 在一个执行检查点可见的 City Tool。 */
  get_session_tools(
    agent_id: string,
    workspace: WorkspaceRuntime,
  ): Record<string, RuntimeTool>;

  /** 返回当前 Agent/Workspace 在一个执行检查点可见的 Session Hook。 */
  get_session_hooks(
    agent_id: string,
    workspace: WorkspaceRuntime,
  ): SessionHookRuntime;

  /** Agent 主动释放时清除 City 持有的运行时引用。 */
  release_agent(agent: {
    /** Agent 的全局稳定标识。 */
    readonly id: string;
  }): Promise<void>;
}
