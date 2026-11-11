/**
 * 当前 City 的可信宿主处理记录入口。
 * 只枚举本实例 JobStore；每次操作重新核对宿主目录，身份仅取自持久化 Job。
 * 普通 Agent actions 继续使用 MemoryService 的原执行范围权限。
 */
import { z } from "zod";
import type { PowerJsonValue, PowerLifecycleContext } from "@downcity/city/power";
import type { MemoryService } from "../application/MemoryService.js";
import type { MemoryDreaming } from "../application/MemoryDreaming.js";
import type { MemoryJobStore } from "../storage/MemoryJobStore.js";
import type { MemoryJob } from "../types/MemoryJob.js";
import type { MemoryRecordListResult } from "../types/MemoryManagement.js";
import { memory_job_view } from "../types/MemoryJob.js";

/** 缺省枚举全部可管理范围；空 Workspace 明确筛选无项目。 */
const list_schema = z.object({
  agent_id: z.string().trim().min(1).optional(),
  workspace_id: z.string().trim().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
}).strict();

/** 详情和重试不接受界面指定执行身份。 */
const job_schema = z.object({ job_id: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();

/** 注册仅可信宿主可调用的全局列表、详情和按原范围重试。 */
export function register_memory_record_host_actions(
  host: PowerLifecycleContext,
  service: MemoryService,
  jobs: MemoryJobStore,
  dreaming: MemoryDreaming,
): void {
  /** 当前目录是唯一管理权限来源；不通过默认 Agent 扩大范围。 */
  const read_permission = async () => {
    const [agents, workspaces] = await Promise.all([
      host.system.list_agents(), host.system.list_workspaces(),
    ]);
    const agent_ids = new Set(agents.map((agent) => agent.agent_id));
    const workspace_ids = new Set(workspaces.map((workspace) => workspace.workspace_id));
    return (job: MemoryJob): boolean => agent_ids.has(job.access.agent_id)
      && (job.access.workspace_id === undefined || workspace_ids.has(job.access.workspace_id));
  };

  /** 读取原始 Job 并校验当前权限；不信任 UI 提供的任何范围。 */
  const read_managed_job = async (input: PowerJsonValue | undefined): Promise<MemoryJob> => {
    const { job_id } = job_schema.parse(input);
    const can_manage = await read_permission();
    const job = await jobs.read(job_id);
    if (!job) throw new Error("Memory Job not found");
    if (!can_manage(job)) throw new Error("Memory Job is outside the current host management scope");
    return job;
  };

  host.power.action({ id: "memory.records.list", run: async (input) => {
    const filter = list_schema.parse(input ?? {});
    const can_manage = await read_permission();
    const records = (await jobs.list()).filter((job) => can_manage(job)
      && (filter.agent_id === undefined || job.access.agent_id === filter.agent_id)
      && (filter.workspace_id === undefined || job.access.workspace_id === (filter.workspace_id || undefined)))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || left.job_id.localeCompare(right.job_id));
    const offset = filter.offset ?? 0;
    const result: MemoryRecordListResult = {
      items: records.slice(offset, offset + (filter.limit ?? 30)).map(memory_job_view),
      total: records.length,
    };
    return result as unknown as PowerJsonValue;
  } });
  host.power.action({ id: "memory.records.detail", run: async (input) => {
    const job = await read_managed_job(input);
    return await service.job_detail(job.access, job.job_id) as unknown as PowerJsonValue;
  } });
  host.power.action({ id: "memory.records.retry", run: async (input) => {
    const job = await read_managed_job(input);
    return (job.kind === "dream"
      ? await dreaming.retry_job(job)
      : await service.retry(job.access, job.job_id)) as unknown as PowerJsonValue;
  } });
}
