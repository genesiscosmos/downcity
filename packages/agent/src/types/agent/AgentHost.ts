/**
 * Agent 宿主装配协议。
 *
 * Agent 只声明运行所需的最小宿主能力，不认识 City 的具体实现。City 作为上层
 * 组合根实现这些端口，从而保持 `city -> agent` 的单向依赖。
 */

import type { Embassy } from "@downcity/federation";
import type { RuntimeTool } from "@downcity/type";
import type { StorageProvider, WorkspaceRuntime } from "@downcity/type";
import type { Agent } from "@/agent/Agent.js";
import type { Logger } from "@/utils/logger/Logger.js";
import type { SessionExtensionRuntime } from "@downcity/type/session";

/** Agent 加入上层组合根时获得的宿主能力。 */
export interface AgentHost {
  /** 宿主为 Agent 提供的持久化根。 */
  readonly storage: StorageProvider;

  /** 宿主可选的 Federation Embassy。 */
  readonly embassy?: Embassy;

  /** 按稳定 ID 读取宿主登记的 Workspace。 */
  get_workspace(workspace_id: string): WorkspaceRuntime | null;

  /** Agent 主动释放时通知宿主移除自身。 */
  release_agent(agent: Agent): Promise<void>;
}

/** 上层宿主向单个 Agent 投影的通用 Extension 执行能力。 */
export interface AgentHostExtensions {
  /** 等待当前 Agent 的全部 Extension 完成初始化。 */
  ensure_ready(): Promise<void>;

  /** 启动当前 Agent/Workspace 的 Extension 作用域生命周期。 */
  ensure_workspace_ready(workspace: WorkspaceRuntime, logger: Logger): Promise<void>;

  /** 释放当前 Agent/Workspace 的 Extension 作用域生命周期。 */
  release_workspace(workspace_id: string): Promise<void>;

  /** 返回当前 Workspace 的 Extension 模型 Tool。 */
  tools(workspace: WorkspaceRuntime, logger: Logger): Record<string, RuntimeTool>;

  /** 创建当前 Workspace 的 Session 扩展执行视图。 */
  execution_runtime(workspace: WorkspaceRuntime, logger: Logger): SessionExtensionRuntime;

  /** 订阅当前 Agent 的 Extension 绑定变化。 */
  subscribe(subscriber: (change: {
    /** 变化类型。 */
    readonly type: "register" | "unregister";
    /** Extension 稳定 ID。 */
    readonly extension_name: string;
    /** 是否属于 Agent 加入宿主时的初始装配。 */
    readonly initial: boolean;
  }) => void): () => void;
}
