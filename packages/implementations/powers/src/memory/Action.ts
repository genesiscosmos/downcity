/**
 * Memory Power action 适配层。
 *
 * 关键点（中文）
 * - Action 只把 Agent/Session 上下文映射为 MemoryProvider 的领域输入。
 * - 物理存储、检索实现和提炼策略全部属于 Provider。
 * - 所有 Provider 异常都转换为稳定 PowerActionResult，不伪造成功。
 */

import type { PowerActionResult, PowerJsonValue } from "@downcity/city/power";
import type {
  MemoryForgetInput,
  MemoryListInput,
  MemoryProvider,
  MemoryReadInput,
  MemoryRecallInput,
  MemoryRememberInput,
} from "@/memory/types/Memory.js";
import type { MemoryAccessContext } from "@/memory/types/MemoryAccess.js";

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

/** list action，按作用域枚举可读记忆。 */
export async function list_memory_action(
  provider: MemoryProvider,
  access: MemoryAccessContext,
  input: Omit<MemoryListInput, "access">,
): Promise<PowerActionResult<PowerJsonValue>> {
  return await run_provider_action(async () => await provider.list({
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
  return await run_provider_action(async () => {
    const result = await provider.remember({ ...input, access });
    return {
      target: input.target,
      mode: "knowledge",
      status: result.mode,
      memory_id: result.memory_id,
      ...(result.evidence_id ? { evidence_id: result.evidence_id } : {}),
      ...(result.summary ? { summary: result.summary } : {}),
      activation: "on_recall",
      location: "wiki",
    };
  });
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
