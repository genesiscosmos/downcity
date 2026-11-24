/** Activity 错误正文的最小输入；不持有面板、执行能力或原始工具参数。 */
import type { ChatControlMessages } from "./chat-controls";

/** 原文只能通过显式复制公开；调用方负责判断完整来源是否允许披露。 */
export interface ActivityErrorContentProps extends ChatControlMessages {
  /** 用户可读的简短原因，作为纯文本自然换行，不解析 Markdown 或展示原始信封。 */
  reason: string;
  /** 经过来源权限和私密输入检查的完整原文；缺省或空白时省略复制操作。 */
  original?: string;
}
