/** 持久化准备协调器：模型在事务外运行，提交时检查版本与处理身份。 */
import { randomUUID } from "node:crypto";
import { resolve_task_delegation } from "./TaskDelegationService.js";
import type { PowerLifecycleContext } from "@downcity/city/power";
import type { TaskAnalyzer, TaskAnalysis } from "../types/TaskPreparation.js";
import type { TaskDefinitionRepository } from "../runtime/TaskDefinitionRepository.js";
import { inspect_task_definitions, readTask, writeTask } from "../runtime/Store.js";
import { validate_task_schedule } from "./TaskScheduleValidation.js";
import type { TaskSchedulerReloadResult } from "../types/TaskPowerTypes.js";
import { task_analysis_schema } from "../runtime/TaskPreparationSchema.js";
import { normalize_task_due, normalize_task_instant, task_work_is_closed } from "../runtime/TaskWorkflowModel.js";

/** 每条任务最多一个准备过程，重启重新领取未完成准备，不重放执行。 */
export class TaskPreparationCoordinator {
  private readonly pending = new Map<string, Promise<void>>();
  private readonly abort = new AbortController();
  constructor(
    private readonly context: PowerLifecycleContext,
    private readonly definitions: TaskDefinitionRepository,
    private readonly analyze?: TaskAnalyzer,
    /** 定义提交后同步现有调度器，不在模型端口中启动执行。 */
    private readonly reconcile?: (task_id: string) => Promise<TaskSchedulerReloadResult>,
    /** 仅在本次生成明确要求立即执行时受理，不在重启恢复时重放。 */
    private readonly start?: (task_id: string) => Promise<string | undefined>,
  ) {}

  /** 恢复持久化的准备请求。 */
  async initialize(): Promise<void> {
    const inspection = await inspect_task_definitions(this.definitions.storage);
    for (const entry of inspection.tasks) {
      const task = await readTask({ storage: this.definitions.storage, taskId: entry.taskId });
      if (["queued", "analyzing", "delegating"].includes(task.frontmatter.preparation?.status || "")) this.enqueue(entry.taskId);
      const preparation = task.frontmatter.preparation;
      if (preparation?.status === "ready" && preparation.schedule_error && !task_work_is_closed(task) && this.reconcile) {
        const result = await this.reconcile(entry.taskId).catch((error): TaskSchedulerReloadResult => ({ reloaded: false, error: String(error) }));
        await this.definitions.mutate(async (storage) => {
          const current = await readTask({ storage, taskId: entry.taskId });
          const latest = current.frontmatter.preparation;
          if (!latest || latest.revision !== preparation.revision || latest.status !== "ready" || task_work_is_closed(current)) return;
          current.frontmatter.preparation = { ...latest, schedule_error: result.reloaded ? undefined : result.error || "自动安排同步失败" };
          await writeTask({ storage, taskId: entry.taskId, frontmatter: current.frontmatter, body: current.body, overwrite: true });
        });
      }
    }
  }

  /** 排队不阻塞录入响应；失败已写入任务，不作为未处理异常抛出。 */
  enqueue(task_id: string): void {
    if (this.abort.signal.aborted || this.pending.has(task_id)) return;
    const operation = Promise.resolve().then(() => this.prepare(task_id)).catch((error) => {
      this.context.logger.warn("[TASK] Preparation failed", { task_id, error: String(error) });
    }).finally(async () => {
      this.pending.delete(task_id);
      if (this.abort.signal.aborted) return;
      const current = await readTask({ storage: this.definitions.storage, taskId: task_id }).catch(() => undefined);
      if (current?.frontmatter.preparation?.status === "queued" && !task_work_is_closed(current)) this.enqueue(task_id);
    });
    this.pending.set(task_id, operation);
  }

  /** 等待同一任务的准备请求收口，包括处理中收到的新版本；失败信息保留在任务中。 */
  async generate(task_id: string): Promise<void> {
    if (this.abort.signal.aborted) throw new Error("任务生成服务已关闭");
    this.enqueue(task_id);
    while (this.pending.has(task_id)) {
      await this.pending.get(task_id);
      if (this.abort.signal.aborted) throw new Error("任务生成已中断");
    }
  }

  /** 生命周期结束时取消模型调用并等待写回收口。 */
  async dispose(): Promise<void> {
    this.abort.abort();
    await Promise.allSettled([...this.pending.values()]);
  }

  private async prepare(task_id: string): Promise<void> {
    const processing_id = randomUUID();
    const task = await this.definitions.mutate(async (storage) => {
      const current = await readTask({ storage, taskId: task_id });
      const preparation = current.frontmatter.preparation;
      if (!preparation || task_work_is_closed(current) || !["queued", "analyzing", "delegating"].includes(preparation.status)) return;
      current.frontmatter.preparation = { ...preparation, status: "analyzing", processing_id, error: undefined };
      await writeTask({ storage, taskId: task_id, frontmatter: current.frontmatter, body: current.body, overwrite: true });
      return current;
    });
    if (!task?.frontmatter.preparation) return;
    const revision = task.frontmatter.preparation.revision;
    try {
      if (!this.analyze) throw new Error("尚未配置任务分析模型，可在详情中手动设置任务");
      const [agents, workspaces] = await Promise.all([this.context.system.list_agents(), this.context.system.list_workspaces()]);
      const text = [task.frontmatter.intake?.text ?? task.body, ...task.frontmatter.preparation.supplements].join("\n\n补充：\n");
      let analysis: TaskAnalysis = task_analysis_schema.parse(await this.analyze({
        text,
        agent_id: task.frontmatter.intake?.agent_id,
        ...(task.frontmatter.preparation.analyzed_body ? { previous: {
          title: task.frontmatter.title, body: task.frontmatter.preparation.analyzed_body,
          kind: task.frontmatter.kind === "agent" ? "agent" as const : "self" as const,
          agent_id: task.frontmatter.agent_id, workspace_id: task.frontmatter.workspace_id,
          when: task.frontmatter.when, start_now: task.frontmatter.preparation.start_now,
          planned_at: task.frontmatter.workflow?.planned_at, planned_end_at: task.frontmatter.workflow?.planned_end_at, due_at: task.frontmatter.workflow?.due_at,
          questions: [], assumptions: task.frontmatter.preparation.assumptions || [],
        } } : {}),
        revision, received_at: new Date().toISOString(),
        timezone: task.frontmatter.workflow!.timezone, planned_at: task.frontmatter.workflow?.planned_at,
        catalog: { agents: agents.map(({ agent_id, name }) => ({ agent_id, name })), workspaces: workspaces.map(({ workspace_id, name }) => ({ workspace_id, name })) },
      }, AbortSignal.any([this.abort.signal, AbortSignal.timeout(60000)])));
      // 显式选择优先于模型建议，目标是否仍存在由委派服务校验。
      if (task.frontmatter.intake?.agent_id) {
        analysis.kind = "agent";
        analysis.agent_id = task.frontmatter.intake.agent_id;
      }
      const planned_at = normalize_task_instant(analysis.planned_at);
      const due_at = normalize_task_due(analysis.due_at);
      const planned_end_at = normalize_task_instant(analysis.planned_end_at);
      if (planned_end_at && (!planned_at || Date.parse(planned_end_at) <= Date.parse(planned_at))) throw new Error("计划结束时间必须晚于计划开始时间");
      if (analysis.kind === "agent") {
        await this.definitions.mutate(async (storage) => {
          const current = await readTask({ storage, taskId: task_id });
          const preparation = current.frontmatter.preparation;
          if (task_work_is_closed(current) || preparation?.revision !== revision || preparation.processing_id !== processing_id || this.abort.signal.aborted) return;
          current.frontmatter.preparation = { ...preparation, status: "delegating" };
          await writeTask({ storage, taskId: task_id, frontmatter: current.frontmatter, body: current.body, overwrite: true });
        });
      }
      analysis = resolve_task_delegation(analysis, { agents, workspaces }, task.frontmatter.intake?.agent_id, task.frontmatter.delivery_session?.workspace_id || undefined);
      const when = validate_task_schedule(analysis.when);
      const start_now = analysis.kind === "agent" && when === "@manual" && analysis.start_now === true;
      const committed = await this.definitions.mutate(async (storage) => {
        const current = await readTask({ storage, taskId: task_id });
        const preparation = current.frontmatter.preparation;
        if (task_work_is_closed(current) || preparation?.revision !== revision || preparation.processing_id !== processing_id || this.abort.signal.aborted) return;
        current.frontmatter.title = analysis.title;
        current.frontmatter.description = analysis.body.slice(0, 160);
        current.frontmatter.kind = analysis.kind;
        current.frontmatter.agent_id = analysis.kind === "agent" ? analysis.agent_id : "";
        current.frontmatter.workspace_id = analysis.kind === "agent" ? analysis.workspace_id : "";
        // 类型只取决于是否循环，时间点仍然属于一次性待办。
        current.frontmatter.shell_type = when === "@manual" || when.startsWith("time:") ? "todo" : "schedule";
        current.frontmatter.when = validate_task_schedule(when);
        current.frontmatter.status = when === "@manual" ? "paused" : "enabled";
        current.frontmatter.workflow = { ...current.frontmatter.workflow!, planned_at, planned_end_at, due_at };
        current.frontmatter.preparation = { ...preparation, status: "ready", questions: [], analyzed_body: analysis.body, assumptions: analysis.assumptions || [], start_now, start_error: undefined, schedule_error: undefined, processing_id: undefined };
        await writeTask({ storage, taskId: task_id, frontmatter: current.frontmatter, body: current.body, overwrite: true });
        return true;
      });
      if (!committed) return;
      const scheduler = await this.reconcile?.(task_id).catch((error): TaskSchedulerReloadResult => ({ reloaded: false, error: String(error) }));
      const start_error = start_now && this.start
        ? await this.start(task_id).catch((error) => String(error))
        : undefined;
      await this.definitions.mutate(async (storage) => {
        const current = await readTask({ storage, taskId: task_id });
        const preparation = current.frontmatter.preparation;
        if (preparation?.revision !== revision || preparation.status !== "ready") return;
        current.frontmatter.preparation = { ...preparation, start_error, schedule_error: scheduler && !scheduler.reloaded ? scheduler.error || "自动安排同步失败" : undefined };
        await writeTask({ storage, taskId: task_id, frontmatter: current.frontmatter, body: current.body, overwrite: true });
      });
    } catch (error) {
      if (this.abort.signal.aborted) return;
      await this.definitions.mutate(async (storage) => {
        const current = await readTask({ storage, taskId: task_id });
        const preparation = current.frontmatter.preparation;
        if (task_work_is_closed(current) || preparation?.revision !== revision || preparation.processing_id !== processing_id) return;
        current.frontmatter.preparation = { ...preparation, status: "failed", error: error instanceof Error ? error.message : String(error), processing_id: undefined };
        await writeTask({ storage, taskId: task_id, frontmatter: current.frontmatter, body: current.body, overwrite: true });
      });
    }
  }
}
