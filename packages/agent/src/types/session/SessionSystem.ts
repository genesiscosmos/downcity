/**
 * Session System Block 组装类型。
 *
 * 该类型只描述默认 Composer 组装 system block 所需的只读输入。
 */

import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type {
  SessionHookContext,
  SessionHookRuntime,
  SessionHookScopeRuntime,
} from "@downcity/type";

/** 默认 Session System Block 的组装参数。 */
export interface BuildSessionSystemBlocksInput {
  /** 当前 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Agent 绑定的项目绝对根目录。 */
  project_root: string;
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Session 首次创建时间，单位为毫秒。 */
  created_at: number;
  /** 当前 Session 初始化时解析到的系统时区。 */
  timezone: string;
  /** 读取当前调用方传入的 Instruction System Block。 */
  get_instruction_system_blocks: () => AgentSessionSystemBlock[];
  /** 读取当前显式注入的受托管 Power System Block。 */
  get_managed_power_system_blocks: () => Promise<AgentSessionSystemBlock[]>;
  /** 读取当前 Session Power 的 System Block。 */
  get_power_system_blocks: () => Promise<AgentSessionSystemBlock[]>;
}

/** 解析 Power system blocks 所需的稳定执行输入。 */
export interface ResolveSessionPowerSystemBlocksInput {
  /** 当前 Session 的稳定标识。 */
  session_id: string;
  /** 当前 Turn 的稳定标识；控制面预览等非 Turn 调用允许为空。 */
  turn_id?: string;
  /** 当前调用捕获的 Hook runtime 或 Step scope。 */
  hooks: SessionHookRuntime | SessionHookScopeRuntime;
  /** 向 Power 暴露的只读 Session 上下文。 */
  context: SessionHookContext;
  /** Power system 解析失败后的可选降级观测入口。 */
  on_error?: (error: unknown) => void | Promise<void>;
}
