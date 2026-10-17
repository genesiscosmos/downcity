/**
 * MemoryPower 可信访问上下文解析。
 *
 * 关键点（中文）
 * - Agent 与 Workspace 身份来自 PowerContext，不从用户文本推断。
 * - User 固定为平台数据根的本地使用者，不依赖登录或消息身份回调。
 * - 缺少 agent_id 时直接失败，不猜测或使用默认 Agent。
 */

import type { PowerContext } from "@downcity/city/power";
import type { MemoryAccessContext } from "@/memory/types/MemoryAccess.js";

/** 解析当前 Memory 访问上下文。 */
export function resolve_memory_access(
  context: PowerContext,
  input: {
    /** 当前调用所属 Session；非 Session 调用时省略。 */
    session_id?: string;
    /** 宿主是否提供 City 共享 Store；默认提供。 */
    city_memory_available?: boolean;
  } = {},
): MemoryAccessContext {
  const agent_id = String(context.agent.id || "").trim();
  if (!agent_id) throw new Error("Memory access requires agent_id");
  const workspace_id = String(context.workspace?.id || "").trim();
  const session_id = String(input.session_id || "").trim();
  return {
    agent_id,
    ...(workspace_id ? { workspace_id } : {}),
    ...(session_id ? { session_id } : {}),
    city_memory_available: input.city_memory_available !== false,
  };
}
