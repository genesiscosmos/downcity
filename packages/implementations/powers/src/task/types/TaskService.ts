/** TaskPower 提供给宿主应用的任务领域协议，与任何界面或 IPC 框架无关。 */
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
}

/** 定义已提交后的业务结果，调度失败不伪装为回滚。 */
export interface TaskMutationResult {
  /** 已修改任务的稳定标识。 */
  task_id: string;
  /** 可选的调度同步结果。 */
  scheduler?: TaskSchedulerReloadResult;
}

/** 宿主任务操作的输入和输出映射。 */
export interface TaskServiceContract {
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
