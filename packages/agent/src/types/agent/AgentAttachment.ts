/**
 * Agent 宿主装配协议。
 *
 * Agent 自己拥有 Session 与存储状态；City 等组合根只通过该窄接口提供宿主资源。
 */

import type { RuntimeTool, StorageProvider, WorkspaceRuntime } from "@downcity/type";
import type { Agent } from "@/agent/Agent.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionHooks } from "@/session/SessionHooks.js";

/** Agent 加入宿主时获得的最小能力。 */
export interface AgentAttachment {
  /** 当前装配关系的唯一所有者，用于拒绝同时加入多个宿主。 */
  readonly owner: object;

  /** 宿主为 Agent 私有运行数据提供的底层存储。 */
  readonly storage: StorageProvider;

  /** 按稳定 ID 读取宿主当前持有的 Workspace。 */
  readonly get_workspace: (workspace_id: string) => WorkspaceRuntime | null;

  /** 等待 Agent 执行依赖的宿主能力完成初始化。 */
  readonly ensure_ready: () => Promise<void>;

  /** 在 Step 检查点读取当前 Agent/Workspace 可用的扩展 Tool。 */
  readonly get_tools: (
    workspace: WorkspaceRuntime,
    logger: Logger,
  ) => Record<string, RuntimeTool>;

  /** 在 Step 检查点创建当前 Agent/Workspace 的 Hook 执行视图。 */
  readonly get_hooks: (
    workspace: WorkspaceRuntime,
    logger: Logger,
  ) => SessionHooks;

  /** Agent 主动释放时通知宿主清除其引用。 */
  readonly release_agent: (agent: Agent) => Promise<void>;
}
