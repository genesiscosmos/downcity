/** Task 发布的可重放领域事实；与验收状态同文件提交，不表示长期记忆已经形成。 */
export interface TaskFact {
  /** 来源存储、Task 和事项共同决定的稳定身份，重投保持不变。 */
  event_id: string;
  /** 仅明确验收或带反馈的修订命令产生领域事实。 */
  event_type: "task_accepted" | "user_correction";
  /** 事实发生时绑定的执行 Agent，后续更换执行目标不改变历史归属。 */
  agent_id: string;
  /** 事实发生时的项目范围，不表示获得项目共享授权。 */
  workspace_id: string;
  /** 原始任务稳定标识。 */
  task_id: string;
  /** 被用户处理的具体结果事项标识。 */
  item_id: string;
  /** 命令成功提交时的 ISO 时间。 */
  occurred_at: string;
  /** 绑定的执行产物目录时间戳，没有产物时为空。 */
  run_timestamp: string;
  /** 用户明确填写的反馈，验收时使用命令事实说明，不能伪造用户原话。 */
  request_text: string;
  /** 当时交付物的有界原文快照，只作为 Agent 表述。 */
  output_text: string;
  /** 完整交付物的 SHA-256 指纹；读取失败时为空。 */
  output_fingerprint: string;
  /** 快照是否仅覆盖交付物的前缀。 */
  output_truncated: boolean;
  /** 产物无法固定时的可观察错误，不影响 Task 用户命令本身。 */
  source_error: string;
}

/** 按可信宿主选定的执行范围读取事实，调用者不得扩大到其他私有 Agent。 */
export interface TaskFactQuery {
  /** 仅返回此 Agent 的既有领域事实。 */
  agent_id: string;
  /** 仅返回此项目的既有领域事实；无项目时省略。 */
  workspace_id?: string;
}
