/**
 * Memory Power action 适配层。
 *
 * 关键点（中文）
 * - Action 只把 Agent/Session 上下文映射为 MemoryProvider 的领域输入。
 * - 物理存储、检索实现和提炼策略全部属于 Provider。
 * - 所有 Provider 异常都转换为稳定 PowerActionResult，不伪造成功。
 */

import type { SessionMessage } from "@downcity/agent";
import type { PowerActionResult, PowerContext, PowerJsonValue } from "@downcity/city/power";
import type {
  MemoryForgetInput,
  MemoryProvider,
  MemoryReadInput,
  MemoryRecallInput,
  MemoryRememberInput,
  MemoryReviseInput,
} from "@/memory/types/Memory.js";
import type { MemoryAccessContext } from "@/memory/types/MemoryAccess.js";

/** 从 canonical Session Message 提取可供 Provider 提炼的文本。 */
function extract_session_message_line(message: SessionMessage): string {
  const role = message.role === "user" ? "User" : "Assistant";
  const text = message.parts
    .flatMap((part) => part.type === "text" ? [String(part.text || "").trim()] : [])
    .filter(Boolean)
    .join("\n")
    .trim();
  return text ? `${role}: ${text}` : "";
}

/** 执行 Provider 调用并统一失败语义。 */
async function run_provider_action(
  action: () => Promise<PowerJsonValue>,
): Promise<PowerActionResult<PowerJsonValue>> {
  try {
    return { success: true, data: await action() };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** status action。 */
export async function status_memory_action(
  provider: MemoryProvider,
  access: MemoryAccessContext,
): Promise<PowerActionResult<PowerJsonValue>> {
  return await run_provider_action(async () => await provider.status(access) as unknown as PowerJsonValue);
}

/** search action，内部委托 Provider recall。 */
export async function search_memory_action(
  provider: MemoryProvider,
  access: MemoryAccessContext,
  input: Omit<MemoryRecallInput, "access">,
): Promise<PowerActionResult<PowerJsonValue>> {
  return await run_provider_action(async () => await provider.recall({
    ...input,
    access,
  }) as unknown as PowerJsonValue);
}

/** read action。 */
export async function read_memory_action(
  provider: MemoryProvider,
  access: MemoryAccessContext,
  input: Omit<MemoryReadInput, "access">,
): Promise<PowerActionResult<PowerJsonValue>> {
  return await run_provider_action(async () => await provider.read({
    ...input,
    access,
  }) as unknown as PowerJsonValue);
}

/** remember action。 */
export async function remember_memory_action(
  provider: MemoryProvider,
  access: MemoryAccessContext,
  input: Omit<MemoryRememberInput, "access">,
): Promise<PowerActionResult<PowerJsonValue>> {
  return await run_provider_action(async () => await provider.remember({
    ...input,
    access,
  }) as unknown as PowerJsonValue);
}

/** digest action：Session 消息读取属于 Power 编排，长期记忆语义属于 Provider。 */
export async function digest_memory_action(
  context: PowerContext,
  provider: MemoryProvider,
  access: MemoryAccessContext,
  input: {
    /** 需要提炼的 Session 标识。 */
    session_id: string;
    /** 可选最大消息提取条数。 */
    max_messages?: number;
  },
): Promise<PowerActionResult<PowerJsonValue>> {
  return await run_provider_action(async () => {
    const session_id = String(input.session_id || "").trim();
    if (!session_id) throw new Error("session_id is required");
    const max_messages = Number.isFinite(input.max_messages)
      ? Math.max(1, Math.floor(input.max_messages as number))
      : 30;
    const messages = await context.agent.sessions.runtime(session_id).messages();
    const start_index = Math.max(0, messages.length - max_messages);
    const lines = messages
      .slice(start_index)
      .map((message) => extract_session_message_line(message as unknown as SessionMessage))
      .filter(Boolean);
    if (lines.length === 0) {
      throw new Error("Session has no user or assistant text to digest");
    }
    const transcript = lines.join("\n\n");
    return await provider.digest({
      session_id,
      access: { ...access, session_id },
      transcript,
      message_count: lines.length,
    }) as unknown as PowerJsonValue;
  });
}

/** revise action。 */
export async function revise_memory_action(
  provider: MemoryProvider,
  access: MemoryAccessContext,
  input: Omit<MemoryReviseInput, "access">,
): Promise<PowerActionResult<PowerJsonValue>> {
  return await run_provider_action(async () => await provider.revise({
    ...input,
    access,
  }) as unknown as PowerJsonValue);
}

/** forget action。 */
export async function forget_memory_action(
  provider: MemoryProvider,
  access: MemoryAccessContext,
  input: Omit<MemoryForgetInput, "access">,
): Promise<PowerActionResult<PowerJsonValue>> {
  return await run_provider_action(async () => await provider.forget({
    ...input,
    access,
  }) as unknown as PowerJsonValue);
}
