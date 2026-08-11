/**
 * Memory Plugin action 适配层。
 *
 * 关键点（中文）
 * - Action 只把 Agent/Session 上下文映射为 MemoryProvider 的领域输入。
 * - 物理存储、检索实现和提炼策略全部属于 Provider。
 * - 所有 Provider 异常都转换为稳定 PluginActionResult，不伪造成功。
 */

import type { PluginActionResult, PluginContext, SessionMessage } from "@downcity/agent";
import type { JsonValue } from "@downcity/agent";
import type {
  MemoryForgetInput,
  MemoryProvider,
  MemoryReadInput,
  MemoryRecallInput,
  MemoryRememberInput,
  MemoryReviseInput,
  MemoryScope,
} from "@/memory/types/Memory.js";

/** 从 PluginContext 构造当前 Runtime 的默认 Memory scope。 */
export function create_memory_scope(
  context: PluginContext,
  session_id?: string,
): MemoryScope {
  return {
    agent_id: context.agent_id,
    workspace_id: context.workspace_path,
    ...(session_id ? { session_id } : {}),
  };
}

/** 从 canonical Session Message 提取可供 Provider 提炼的文本。 */
function extract_session_message_line(message: SessionMessage): string {
  if (message.type !== "user" && message.type !== "assistant") return "";
  const role = message.type === "user" ? "User" : "Assistant";
  const text = message.parts
    .flatMap((part) => part.type === "text" ? [String(part.text || "").trim()] : [])
    .filter(Boolean)
    .join("\n")
    .trim();
  return text ? `${role}: ${text}` : "";
}

/** 执行 Provider 调用并统一失败语义。 */
async function run_provider_action(
  action: () => Promise<JsonValue>,
): Promise<PluginActionResult<JsonValue>> {
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
): Promise<PluginActionResult<JsonValue>> {
  return await run_provider_action(async () => await provider.status() as unknown as JsonValue);
}

/** search action，内部委托 Provider recall。 */
export async function search_memory_action(
  context: PluginContext,
  provider: MemoryProvider,
  input: Omit<MemoryRecallInput, "scope">,
): Promise<PluginActionResult<JsonValue>> {
  return await run_provider_action(async () => await provider.recall({
    ...input,
    scope: create_memory_scope(context),
  }) as unknown as JsonValue);
}

/** read action。 */
export async function read_memory_action(
  context: PluginContext,
  provider: MemoryProvider,
  input: Omit<MemoryReadInput, "scope">,
): Promise<PluginActionResult<JsonValue>> {
  return await run_provider_action(async () => await provider.read({
    ...input,
    scope: create_memory_scope(context),
  }) as unknown as JsonValue);
}

/** remember action。 */
export async function remember_memory_action(
  context: PluginContext,
  provider: MemoryProvider,
  input: Omit<MemoryRememberInput, "scope">,
): Promise<PluginActionResult<JsonValue>> {
  return await run_provider_action(async () => await provider.remember({
    ...input,
    scope: create_memory_scope(context),
  }) as unknown as JsonValue);
}

/** digest action：Session 消息读取属于 Plugin 编排，长期记忆语义属于 Provider。 */
export async function digest_memory_action(
  context: PluginContext,
  provider: MemoryProvider,
  input: {
    /** 需要提炼的 Session 标识。 */
    session_id: string;
    /** 可选最大消息提取条数。 */
    max_messages?: number;
  },
): Promise<PluginActionResult<JsonValue>> {
  return await run_provider_action(async () => {
    const session_id = String(input.session_id || "").trim();
    if (!session_id) throw new Error("session_id is required");
    const max_messages = Number.isFinite(input.max_messages)
      ? Math.max(1, Math.floor(input.max_messages as number))
      : 30;
    const snapshot = await context.sessions.runtime(session_id).context();
    const start_index = Math.max(0, snapshot.messages.length - max_messages);
    const lines = snapshot.messages
      .slice(start_index)
      .map(extract_session_message_line)
      .filter(Boolean);
    if (lines.length === 0) {
      throw new Error("Session has no user or assistant text to digest");
    }
    const transcript = lines.join("\n\n");
    return await provider.digest({
      session_id,
      scope: create_memory_scope(context, session_id),
      transcript,
      message_count: lines.length,
    }) as unknown as JsonValue;
  });
}

/** revise action。 */
export async function revise_memory_action(
  context: PluginContext,
  provider: MemoryProvider,
  input: Omit<MemoryReviseInput, "scope">,
): Promise<PluginActionResult<JsonValue>> {
  return await run_provider_action(async () => await provider.revise({
    ...input,
    scope: create_memory_scope(context),
  }) as unknown as JsonValue);
}

/** forget action。 */
export async function forget_memory_action(
  context: PluginContext,
  provider: MemoryProvider,
  input: Omit<MemoryForgetInput, "scope">,
): Promise<PluginActionResult<JsonValue>> {
  return await run_provider_action(async () => await provider.forget({
    ...input,
    scope: create_memory_scope(context),
  }) as unknown as JsonValue);
}
