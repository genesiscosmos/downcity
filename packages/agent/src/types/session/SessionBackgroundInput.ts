/** 可信宿主的后台结果输入；只描述回投语义，不授予模型任意注入其他会话的能力。 */
import type { AgentSessionPromptInput } from "../sdk/AgentSessionPrompt.js";

/** 已由宿主验证来源及目标归属的后台输入。 */
export interface SessionBackgroundInput {
  /** 发起后台工作的原始 Turn；用于阻止结果混入无关执行。 */
  turn_id: string;
  /** 结果限定的父执行代次；独立 Main 回传 Chat 时省略以允许异步续行。 */
  execution_id?: string;
  /** 稳定业务输入标识；重复投递共用同一 canonical 消息。 */
  request_id: string;
  /** 去重范围，默认绑定原 Turn；session 用于跨发起轮次共享的同一后台结果，标识须包含完整来源身份。 */
  request_scope?: "turn" | "session";
  /** 后台事实和继续处理的说明；内容作为参考数据，不作为用户授权。 */
  query: AgentSessionPromptInput["query"];
  /** 原 Turn 正常完成后是否允许启动后续 Turn；Child 默认只返回所属执行。 */
  resume_after_turn?: boolean;
  /** 是否允许在原 Turn 停止或失败后异步交付；仅用于独立 Main 对 Chat 的交付。 */
  allow_stopped_turn?: boolean;
}

/** 后台接收借用的现有运行时，不拥有第二套队列或计时器。 */
export interface SessionBackgroundHost {
  /** 当前接收目标的稳定标识。 */
  session_id: string;
  /** canonical 消息与去重读取入口。 */
  messages: import("../../session/messages/SessionMessages.js").SessionMessages;
  /** 原 Turn 的持久化终态读取入口。 */
  completions: import("../agent/SessionCompletion.js").SessionCompletionPort | undefined;
  /** 现有输入与执行调度器。 */
  loop: import("../../session/loop/SessionLoop.js").SessionLoop;
  /** 检查异步读取期间停止边界是否发生变化。 */
  is_current: () => boolean;
}

/** canonical 接收成功、明确不再接收，或暂时因其他执行占用而等待重试。 */
export type SessionBackgroundReceipt = "accepted" | "discarded" | "retry";
