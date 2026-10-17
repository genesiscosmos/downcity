/** 后台准备的持久化事实与模型无关端口。 */
import type { TaskWorkspaceSnapshot } from "./TaskWorkflow.js";

export interface TaskPreparation {
  /** 输入版本，每次补充或人工编辑时递增。 */
  revision: number;
  /** 当前准备阶段；失败只由用户显式重试。 */
  status: "queued" | "analyzing" | "delegating" | "needs_input" | "proposed" | "ready" | "failed";
  /** 处理身份，用于拒绝过期模型响应。 */
  processing_id?: string;
  /** 用户补充的文本，按提交顺序保留。 */
  supplements: string[];
  /** 当前需要用户回答的问题。 */
  questions: string[];
  /** 当前准备失败原因，不表示执行失败。 */
  error?: string;
  /** 当前版本生成的说明，与用户原文分别保留。 */
  analyzed_body?: string;
  /** 自动安排尚未同步成功时的可见错误。 */
  schedule_error?: string;
  /** 本版方案采用的默认值和假设，供确认前直接查看。 */
  assumptions?: string[];
  /** 确认后立即执行；确认前不创建触发时间。 */
  start_now?: boolean;
}

export interface TaskAnalysis {
  /** 建议标题，保留正文中的原始内容。 */
  title: string;
  /** 整理后的执行说明。 */
  body: string;
  /** 用户要求的执行方式，不生成脚本。 */
  kind: "self" | "agent";
  /** 真实 Agent 候选身份，个人任务为空。 */
  agent_id: string;
  /** 真实 Workspace 候选身份，个人任务为空。 */
  workspace_id: string;
  /** 明确自动安排的触发规则；未授权时必须为 @manual。 */
  when: string;
  /** 生成方案采用的默认值和假设，不作为阻断问题。 */
  assumptions?: string[];
  /** 用户明确要求现在启动 Agent；仅绑定执行者时为 false。 */
  start_now?: boolean;
  /** 可选计划时刻，不覆盖触发时间。 */
  planned_at?: string;
  /** 一次性工作时间段的结束时刻，必须晚于 planned_at。 */
  planned_end_at?: string;
  /** 可选截止日期。 */
  due_at?: string;
  /** 信息不足时的问题列表。 */
  questions: string[];
}

export interface TaskAnalysisInput {
  /** 原文与补充的完整上下文。 */
  text: string;
  /** 当前输入版本，便于追踪。 */
  revision: number;
  /** 原始接收时刻，解析相对日期的基准。 */
  received_at: string;
  /** 用户的 IANA 时区。 */
  timezone: string;
  /** 日历预选或人工安排的计划时刻。 */
  planned_at?: string;
  /** 用户明确选择的执行 Agent，模型只为其准备工作区与说明。 */
  agent_id?: string;
  /** 已有方案，用户调整时据此修改，保留未涉及的内容。 */
  previous?: TaskAnalysis;
  /** 当前可见目标目录。 */
  catalog: Pick<TaskWorkspaceSnapshot, "agents" | "workspaces">;
}

/** 模型只返回建议，不持有存储或启动执行的能力。 */
export type TaskAnalyzer = (input: TaskAnalysisInput, signal: AbortSignal) => Promise<TaskAnalysis>;
