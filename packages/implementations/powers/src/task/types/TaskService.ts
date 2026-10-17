/** TaskPower 提供给宿主应用的任务领域协议，与任何界面或 IPC 框架无关。 */
import type { TaskGenerateInput, TaskGenerateResult } from "./TaskGenerate.js";
import type { TaskCaptureInput } from "./TaskIntake.js";
import type { TaskWorkspaceSaveInput, TaskWorkspaceSnapshot } from "./TaskWorkflow.js";
import type { TaskRunDetailView, TaskRunHistoryItemView } from "./TaskCommand.js";
import type { TaskSchedulerReloadResult } from "./TaskPowerTypes.js";

/** 修改任务工作生命周期或处理原事项。 */
export interface TaskWorkInput {
  /** 目标任务的稳定身份。 */
  task_id: string;
  /** 本次明确执行的工作操作。 */
  command: "organize" | "start" | "complete" | "cancel" | "reopen" | "pause" | "resume" | "resolve" | "accept" | "revise" | "skip";
  /** 处理特定 Inbox 请求时必须提供原事项 ID。 */
  item_id?: string;
  /** 操作周期发生项的稳定标识。 */
  occurrence_id?: string;
  /** 跳过未来发生项时的计划时刻。 */
  planned_at?: string;
  /** revise 操作保存的非空修改要求；仅保存反馈，不启动执行。 */
  feedback?: string;
}

/** 定义已提交后的业务结果，调度失败不伪装为回滚。 */
export interface TaskMutationResult {
  /** 内容已保存但立即执行未受理时的明确提示，允许在原对象重试。 */
  start_error?: string;
  /** 已修改任务的稳定标识。 */
  task_id: string;
  /** 可选的调度同步结果。 */
  scheduler?: TaskSchedulerReloadResult;
}

/** 宿主任务操作的输入和输出映射。 */
export interface TaskServiceContract {
  /** 统一生成或调整任务，等待方案完成并返回任务信息；不确认或执行。 */
  generate: { /** 原文、来源约束与已有任务身份。 */ input: TaskGenerateInput; /** 已保存任务与当前方案。 */ output: TaskGenerateResult };
  /** 明确确认指定版本的方案，确认后才启用执行安排。 */
  confirm: { /** 待确认方案身份。 */ input: { /** 稳定任务 ID。 */ task_id: string; /** 用户看到的方案版本。 */ revision: number }; /** 生效与调度同步结果。 */ output: TaskMutationResult };
  /** 重新同步已保存的自动安排，不重新分析或创建执行。 */
  reconcile: { /** 目标身份。 */ input: { /** 稳定任务 ID。 */ task_id: string }; /** 调度同步结果。 */ output: TaskMutationResult };
  /** 补充上下文或重试后台准备，不启动实际执行。 */
  prepare: { /** 任务身份及可选补充。 */ input: { /** 稳定任务 ID。 */ task_id: string; /** 本次用户补充，省略表示重试。 */ text?: string; /** 调整时显式选定的新执行者。 */ agent_id?: string }; /** 已排队的任务。 */ output: TaskMutationResult };
  /** 即时记录原文，不等待模型或执行配置。 */
  capture: { /** 原文与重试身份。 */ input: TaskCaptureInput; /** 已持久化任务。 */ output: TaskMutationResult };
  /** 查询统一任务、发生项、Inbox 和执行目标。 */
  snapshot: { /** 无查询参数。 */ input: undefined; /** 当前聚合快照。 */ output: TaskWorkspaceSnapshot };
  /** 创建或编辑工作定义。 */
  save: { /** 完整编辑内容。 */ input: TaskWorkspaceSaveInput; /** 提交结果。 */ output: TaskMutationResult };
  /** 改变工作状态或处理事项。 */
  command: { /** 工作操作。 */ input: TaskWorkInput; /** 提交结果。 */ output: TaskMutationResult };
  /** 异步受理一次真实执行。 */
  run: { /** 执行目标。 */ input: { /** 任务 ID。 */ task_id: string; /** 可选重试发生项。 */ occurrence_id?: string }; /** 受理或失败结果。 */ output: { /** 调用是否成功。 */ success: boolean; /** 可选错误。 */ error?: string; /** 执行受理数据。 */ data?: { /** 是否启动执行。 */ accepted?: boolean } } };
  /** 查询持久化执行历史。 */
  history: { /** 历史所属任务。 */ input: { /** 任务 ID。 */ task_id: string }; /** 按时间排列的执行。 */ output: { /** 执行摘要。 */ runs: TaskRunHistoryItemView[] } };
  /** 查询执行的结果与产物。 */
  run_detail: { /** 具体执行定位。 */ input: { /** 任务 ID。 */ task_id: string; /** 执行目录时间戳。 */ timestamp: string }; /** 结果详情。 */ output: { /** 本次执行。 */ run: TaskRunDetailView } };
  /** 删除任务聚合，运行中拒绝删除。 */
  delete: { /** 目标任务。 */ input: { /** 任务 ID。 */ task_id: string }; /** 删除和调度收口结果。 */ output: TaskMutationResult };
}
