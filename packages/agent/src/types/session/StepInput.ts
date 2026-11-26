/**
 * StepInput 的构造参数类型。
 *
 * 这些字段共同描述「为每个 Step 准备模型输入」所需的最小只读资源；StepInput 不拥有
 * Message、Store、Model 或 Power 生命周期。
 */

import type { AgentTool as Tool, SessionDescriptor, ToolHookSet, WorkspaceRuntime, SessionCallContext } from "@downcity/type";
import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { SessionStorage } from "@/types/store/SessionStorage.js";
import type { SessionComposer } from "@/types/session/SessionComposer.js";
import type { Logger } from "@/utils/logger/Logger.js";

/** StepInput 构造参数。 */
export interface StepInputOptions extends SessionCallContext {
  /** 当前 Agent 已授权会话的只读访问；供 lookup 解析外部与归档引用。 */
  read_result_session?: (session_id: string, type: string) => Promise<import("@/types/store/SessionReadView.js").SessionReadView>;
  /** 当前 Session 所属 Agent 的稳定标识。 */
  agent_id: string;
  /** 读取当前 Agent 的用户可见名称；实时读取，与 system 身份保持一致。 */
  get_agent_name: () => string;
  /** 延迟读取 Agent 可选身份与角色列表。 */
  get_agent_role?: () => string[] | undefined;
  /** 读取当前 Agent 的一句话能力描述；实时读取。 */
  get_agent_description: () => string;
  /** 当前 Session 的稳定标识。 */
  session_id: string;

  /** 当前 Session 使用的目录解析器；目录是可变的会话状态。 */
  get_workspace_path: () => string;
  /** 当前 Session 的领域持久化视图。 */
  store: SessionStorage;
  /** 当前 Session 使用的统一 Composer。 */
  composer: SessionComposer;
  /** 在每个 Step 检查点读取当前可用 Tool 集合。 */
  get_tools: () => Record<string, Tool>;
  /** 读取当前 Session 的当前目录；未绑定时返回 undefined。 */
  get_workspace?: () => WorkspaceRuntime | undefined;
  /** 读取当前持久化的目录标识；内存实例不存在时用它触发还原。 */
  /** 把持久化的 workspace_id 还原为当前可用实例；由宿主在注入时提供。 */
  /** 当前 Session 创建时捕获的 instruction system blocks。 */
  instruction_system_blocks: AgentSessionSystemBlock[];
  /** 显式刷新 system 时读取 Agent 最新 instruction system blocks。 */
  get_instruction_system_blocks: () => AgentSessionSystemBlock[];
  /** 在每个 Step 检查点读取当前生效的扩展处理器集合。 */
  get_hooks: () => ToolHookSet;
  /** 读取当前 Session 的创建时间戳。 */
  get_created_at: () => number;
  /** 读取当前 Session 的参考时区。 */
  get_timezone: () => string;
  /** 记录 Power Hook 降级等可观察事件。 */
  logger: Logger;
}
