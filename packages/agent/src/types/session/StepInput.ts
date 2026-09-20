/**
 * StepInput 的构造参数类型。
 *
 * 这些字段共同描述「为每个 Step 准备模型输入」所需的最小只读资源；StepInput 不拥有
 * Message、Store、Model 或 Power 生命周期。
 */

import type {
  ModelClient,
  AgentTool as Tool,
  SessionOrigin,
  ToolHookSet,
  WorkspaceRuntime,
} from "@downcity/type";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionComposer } from "@/types/session/SessionComposer.js";
import type { Logger } from "@/utils/logger/Logger.js";

/** StepInput 构造参数。 */
export interface StepInputOptions {
  /** 当前 Session 所属 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Agent 的用户可见名称。 */
  agent_name: string;
  /** 当前 Agent 的一句话能力描述。 */
  agent_description: string;
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Session 的创建来源。 */
  session_origin: SessionOrigin;
  /** 当前 Session 使用的 Workspace 绝对根目录。 */
  workspace_path: string;
  /** 当前 Session 的领域持久化视图。 */
  store: SessionStorage;
  /** 当前 Session 使用的统一 Composer。 */
  composer: SessionComposer;
  /** 在每个 Step 检查点读取当前可用 Tool 集合。 */
  get_tools: () => Record<string, Tool>;
  /** 读取当前 Session 绑定的 Workspace 实例；未绑定时返回 undefined。 */
  get_workspace?: () => WorkspaceRuntime | undefined;
  /** 当前 Session 创建时捕获的 instruction system blocks。 */
  instruction_system_blocks: AgentSessionSystemBlock[];
  /** 显式刷新 system 时读取 Agent 最新 instruction system blocks。 */
  get_instruction_system_blocks: () => AgentSessionSystemBlock[];
  /** 在每个 Step 检查点读取当前生效的扩展处理器集合。 */
  get_hooks: () => ToolHookSet;
  /** 在每个 Step 检查点读取 Workspace env。 */
  get_workspace_env: () => Record<string, string>;
  /** 读取当前 Session 实际使用的模型。 */
  get_model: () => ModelClient | undefined;
  /** 读取当前模型声明的上下文窗口。 */
  get_model_context_window: () => number | undefined;
  /** 读取当前 Session 的创建时间戳。 */
  get_created_at: () => number;
  /** 读取当前 Session 的参考时区。 */
  get_timezone: () => string;
  /** 记录 Power Hook 降级等可观察事件。 */
  logger: Logger;
}
