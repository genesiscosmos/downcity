/** 统一记录的事务能力及范围授权；不从标题或模型参数推断归属。 */
import type { MemoryProvider, MemoryRecord, MemoryScopeType } from "../types/MemoryProtocol.js";
import type { MemoryAccessContext } from "../types/MemoryAccess.js";
import { resolve_writable_memory_address } from "../runtime/MemoryAddress.js";
/** 强事务缺失时拒绝，不能降级为逐条写入。 */
export function require_memory_transactions(provider: MemoryProvider) {
  if (!provider.capabilities.transactions || !provider.transactions) throw new Error("Memory transactions unavailable");
  return provider.transactions;
}
/** 用真实身份比较 scope。 */
export function memory_matches_target(record: MemoryRecord, access: MemoryAccessContext, scope: MemoryScopeType): boolean {
  const resolved = resolve_writable_memory_address(access, scope).scope;
  return record.scope.type === resolved.type && record.scope.id === resolved.id;
}
/** 已读对象重新核对可写范围。 */
export function memory_record_target(record: MemoryRecord, access: MemoryAccessContext): MemoryScopeType {
  if (!memory_matches_target(record, access, record.scope.type)) throw new Error("Memory access denied");
  return record.scope.type;
}
/** 不透明 ID 的对象必须由后端读取后重新授权。 */
export async function read_target_memory(provider: MemoryProvider, access: MemoryAccessContext, scope: MemoryScopeType, memory_id: string): Promise<MemoryRecord> {
  const { memory } = await provider.read({ access, memory_id });
  if (!memory || memory.memory_id !== memory_id || !memory_matches_target(memory, access, scope)) throw new Error("Memory outside Job scope or unavailable");
  return memory;
}
