/** 即时任务录入协议；记录任务不依赖模型或执行环境。 */
export interface TaskCaptureInput {
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
