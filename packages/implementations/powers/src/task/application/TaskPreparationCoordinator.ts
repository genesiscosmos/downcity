/** 持久化准备协调器：模型在事务外运行，提交时检查版本与处理身份。 */
import { randomUUID } from "node:crypto";
import { validate_task_delegation } from "./TaskDelegationService.js";
import type { PowerLifecycleContext } from "@downcity/city/power";
import type { TaskAnalyzer } from "../types/TaskPreparation.js";
import type { TaskDefinitionRepository } from "../runtime/TaskDefinitionRepository.js";
import { inspect_task_definitions, readTask, writeTask } from "../runtime/Store.js";
import { normalizeTaskWhen } from "../runtime/Model.js";
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
      const text = [task.body, ...task.frontmatter.preparation.supplements].join("\n\n补充：\n");
      const analysis = task_analysis_schema.parse(await this.analyze({
        text,
        revision, received_at: task.frontmatter.workflow!.created_at,
        timezone: task.frontmatter.workflow!.timezone, planned_at: task.frontmatter.workflow?.planned_at,
        catalog: { agents: agents.map(({ agent_id, name }) => ({ agent_id, name })), workspaces: workspaces.map(({ workspace_id, name }) => ({ workspace_id, name })) },
      }, AbortSignal.any([this.abort.signal, AbortSignal.timeout(60000)])));
      const planned_at = normalize_task_instant(analysis.planned_at);
      const due_at = normalize_task_due(analysis.due_at);
      if (analysis.kind === "agent") {
        await this.definitions.mutate(async (storage) => {
          const current = await readTask({ storage, taskId: task_id });
          const preparation = current.frontmatter.preparation;
          if (task_work_is_closed(current) || preparation?.revision !== revision || preparation.processing_id !== processing_id || this.abort.signal.aborted) return;
          current.frontmatter.preparation = { ...preparation, status: "delegating" };
          await writeTask({ storage, taskId: task_id, frontmatter: current.frontmatter, body: current.body, overwrite: true });
        });
      }
      const questions = validate_task_delegation(analysis, { agents, workspaces }, text);
      // 即时启动也使用持久化的一次性安排；发生项负责跨回调去重。
      const normalized_when = normalizeTaskWhen(analysis.start_now && !questions.length
        ? `time:${new Date(Date.now() + 1000).toISOString()}`
        : analysis.when);
      const committed = await this.definitions.mutate(async (storage) => {
        const current = await readTask({ storage, taskId: task_id });
        const preparation = current.frontmatter.preparation;
        if (task_work_is_closed(current) || preparation?.revision !== revision || preparation.processing_id !== processing_id || this.abort.signal.aborted) return;
        current.frontmatter.title = analysis.title;
        current.frontmatter.description = analysis.body.slice(0, 160);
        if (!questions.length) {
          current.frontmatter.kind = analysis.kind;
          current.frontmatter.agent_id = analysis.kind === "agent" ? analysis.agent_id : "";
          current.frontmatter.workspace_id = analysis.kind === "agent" ? analysis.workspace_id : "";
          current.frontmatter.when = normalized_when.ok ? normalized_when.value : "@manual";
          current.frontmatter.status = current.frontmatter.when === "@manual" ? "paused" : "enabled";
        }
        current.frontmatter.workflow = { ...current.frontmatter.workflow!, ...(planned_at ? { planned_at } : {}), ...(due_at ? { due_at } : {}) };
        current.frontmatter.preparation = { ...preparation, status: questions.length ? "needs_input" : "ready", questions: [...new Set(questions)], analyzed_body: analysis.body, authorization_quote: !questions.length ? analysis.authorization_quote : undefined, schedule_error: undefined, processing_id: undefined };
        await writeTask({ storage, taskId: task_id, frontmatter: current.frontmatter, body: current.body, overwrite: true });
        return true;
      });
      if (committed && !questions.length && normalized_when.ok && normalized_when.value !== "@manual") {
        const result = this.reconcile
          ? await this.reconcile(task_id).catch((error): TaskSchedulerReloadResult => ({ reloaded: false, error: String(error) }))
          : { reloaded: false, error: "尚未连接任务调度器" };
        await this.definitions.mutate(async (storage) => {
          const current = await readTask({ storage, taskId: task_id });
          const preparation = current.frontmatter.preparation;
          if (preparation?.revision !== revision || preparation.status !== "ready" || task_work_is_closed(current)) return;
          current.frontmatter.preparation = { ...preparation, schedule_error: result.reloaded ? undefined : result.error || "自动安排同步失败" };
          await writeTask({ storage, taskId: task_id, frontmatter: current.frontmatter, body: current.body, overwrite: true });
        });
      }
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
