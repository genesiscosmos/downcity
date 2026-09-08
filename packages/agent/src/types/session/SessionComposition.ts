/**
 * Session system 快照与模型输入组装的依赖类型。
 *
 * 这些字段共同描述 composition 领域所需的最小只读资源；SessionComposition 不拥有
 * Message、Store、Model 或 Plugin 生命周期。
 */

import type { ModelClient, RuntimeTool as Tool } from "@downcity/type";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { SessionOrigin } from "@downcity/type";
import type { SessionDataStore } from "@/types/store/SessionDataStore.js";
import type { SessionMessages } from "@/session/SessionMessages.js";
import type { SessionHookRuntime } from "@downcity/type";
import type { SessionComposer } from "@/types/session/SessionComposer.js";
import type { Logger } from "@/utils/logger/Logger.js";

/** SessionComposition 构造参数。 */
export interface SessionCompositionOptions {
  /** 当前 Session 所属 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Session 的创建来源。 */
  session_origin: SessionOrigin;
  /** 当前 Session 使用的 Workspace 绝对根目录。 */
  workspace_path: string;
  /** 当前 Session 的领域持久化视图。 */
  store: SessionDataStore;
  /** canonical Message 唯一事实源。 */
  messages: SessionMessages;
  /** 当前 Session 使用的统一 Composer。 */
  composer: SessionComposer;
  /** 在每个 Step 检查点读取当前可用 Tool 集合。 */
  get_tools: () => Record<string, Tool>;
  /** 当前 Session 创建时捕获的 instruction system blocks。 */
  instruction_system_blocks: AgentSessionSystemBlock[];
  /** 显式 syncshot 时读取 Agent 最新 instruction system blocks。 */
  get_instruction_system_blocks: () => AgentSessionSystemBlock[];
  /** 显式 syncshot 时读取当前配置的 Hook 执行视图。 */
  get_hooks: () => SessionHookRuntime;
  /** 在每个 Step 检查点读取 Workspace env。 */
  get_workspace_env: () => Record<string, string>;
  /** 读取宿主显式注入的受托管 Plugin system blocks。 */
  get_managed_plugin_system_blocks: () => Promise<AgentSessionSystemBlock[]>;
  /** 读取当前 Session 实际使用的模型。 */
  get_model: () => ModelClient | undefined;
  /** 读取当前模型声明的上下文窗口。 */
  get_model_context_window: () => number | undefined;
  /** 读取当前 Session 的创建时间戳。 */
  get_created_at: () => number;
  /** 读取当前 Session 的参考时区。 */
  get_timezone: () => string;
  /** 记录 Plugin Hook 降级等可观察事件。 */
  logger: Logger;
}
