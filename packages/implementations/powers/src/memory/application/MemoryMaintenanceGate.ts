/** 后台 Job 的独立准入检查：只核对持久开关与批次归属，不依赖维护调度或执行器实例。 */
import type { MemorySignalStore } from "../storage/MemorySignalStore.js";
import type { MemoryJob } from "../types/MemoryJob.js";

/** 每次执行前重新读取开关，已关闭范围不得开始新的后台计算。 */
export async function can_run_memory_background(store: Pick<MemorySignalStore, "read">, owner_id: string, job: MemoryJob): Promise<boolean> {
  if (job.kind !== "dream" || job.memory_kind !== "knowledge" || job.scope === "user") return false;
  const ledger = await store.read({ agent_id: job.access.agent_id, workspace_id: job.access.workspace_id, scope: job.scope });
  return ledger.enabled && ledger.batches.some((batch) => batch.job_id === job.job_id && batch.owner_id === owner_id);
}
