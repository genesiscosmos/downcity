/** 即时任务录入协议；记录任务不依赖模型或执行环境。 */
export interface TaskCaptureInput {
  /** 创建入口明确选择的外壳，省略时由整理结果建议。 */
  shell_type?: "todo" | "schedule";
  /** 用户提交的完整原文，最多 24000 字符。 */
  text: string;
  /** 客户端为一次提交生成的 UUID，重试时保持不变。 */
  submission_id: string;
  /** 当前入口是否已完成整理，默认 false。 */
  organized?: boolean;
  /** 日历预选的计划时间，不代表自动执行授权。 */
  planned_at?: string;
  /** 用户提交时的 IANA 时区。 */
  timezone: string;
  /** 用户通过 @ 候选明确选择的 Agent，后台不得替换该目标。 */
  agent_id?: string;
}

/** 随任务原子保存的录入事实。 */
export interface TaskIntake {
  /** 原始提交标识，用于拒绝冲突重试。 */
  submission_id: string;
  /** 原始文本，不由生成内容覆盖。 */
  text: string;
  /** 本次提交的规范化请求，用于完整比较重试。 */
  request_key: string;
  /** 用户明确选择的 Agent 身份，未指定时由后台判断。 */
  agent_id?: string;
}
