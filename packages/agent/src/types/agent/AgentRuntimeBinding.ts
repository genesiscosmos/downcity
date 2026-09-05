/**
 * Agent 的内部资源绑定协议。
 *
 * 该协议只供 City 等组合根装配 Agent，不代表公开领域对象。Agent 通过它借用存储、
 * Workspace 校验和 Hook 能力，同时保持对具体 City 实现无感知。
 */

import type { RuntimeTool, StorageProvider, WorkspaceRuntime } from "@downcity/type";
import type { Agent } from "@/agent/Agent.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionHooks } from "@/session/SessionHooks.js";

/** Agent 加入资源容器时获得的最小运行能力。 */
export interface AgentRuntimeBinding {
  /** 标识当前绑定所有者，用于拒绝一个 Agent 同时加入多个容器。 */
  readonly owner: object;

  /** 资源容器为 Agent 提供的底层存储。 */
  readonly storage: StorageProvider;

  /** 按稳定 ID 读取资源容器登记的 Workspace。 */
  readonly get_workspace: (workspace_id: string) => WorkspaceRuntime | null;

  /** 等待当前 Agent 可使用的全部 City 能力完成初始化。 */
  readonly ensure_ready: () => Promise<void>;

  /** 建立当前 Agent/Workspace 的 Plugin 调用上下文。 */
  readonly connect_workspace: (workspace: WorkspaceRuntime, logger: Logger) => Promise<void>;

  /** 释放当前 Agent/Workspace 的 Plugin 调用上下文。 */
  readonly disconnect_workspace: (workspace_id: string) => Promise<void>;

  /** 返回当前 Agent/Workspace 可用的 Plugin Tool。 */
  readonly tools: (workspace: WorkspaceRuntime, logger: Logger) => Record<string, RuntimeTool>;

  /** 返回当前 Agent/Workspace 对应的 Session Hook 集合。 */
  readonly hooks: (workspace: WorkspaceRuntime, logger: Logger) => SessionHooks;

  /** 订阅 City Plugin 集合变化。 */
  readonly subscribe_plugins: (subscriber: (change: {
    /** Plugin 变化类型。 */
    readonly type: "add" | "remove";
    /** Plugin 稳定 ID。 */
    readonly plugin_id: string;
    /** 是否属于 Agent 加入 City 时的初始装配。 */
    readonly initial: boolean;
  }) => void) => () => void;

  /** Agent 主动释放时通知资源容器移除自身。 */
  readonly release_agent: (agent: Agent) => Promise<void>;
}
