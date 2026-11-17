/**
 * Session 输入的接收边界。
 *
 * User Message 或 inbox Part 成功落盘即成为 accepted 事实，之后的取消不能撤销它。
 * 真人追加输入建立回复边界；运行时输入沿同一 FIFO 在完整 Step 后追加，不关闭 Writer。
 */

import { nanoid } from "nanoid";
import type { SessionAgentInboxPart, SessionInboxInput, SessionUserMessage } from "@downcity/type";
import type { SessionCommand } from "@/types/session/SessionCommand.js";
import type { SessionTurnContext, SessionTurnInboxInput } from "@/types/turn/SessionTurnContext.js";
import { normalize_inbox_content } from "@/session/messages/SessionUserMessage.js";
import type { SessionQueue } from "./SessionQueue.js";

/** 单次 canonical 输入提交所需的操作；持久化后不再检查普通取消。 */
export interface SessionInputAcceptanceOptions {
  /** 最后一次接收检查，包含调用方取消、Turn 取消及 stop 代次。 */
  assert_receivable: () => void;
  /** 返回已经持久化的真人消息或运行时 inbox Part。 */
  persist: () => Promise<SessionUserMessage | SessionAgentInboxPart>;
  /** canonical 输入已经存在时同步兑现接收回执。 */
  accepted: () => void;
  /** 输入归属的执行上下文。 */
  turn_context: SessionTurnContext;
  /** 首条真人输入没有旧回复；后续真人输入才建立回复边界。 */
  close_previous: boolean;
}

/** 成功落盘是不可撤销的接收点；收口失败仍须终止当前执行。 */
export async function accept_session_input(options: SessionInputAcceptanceOptions): Promise<void> {
  options.assert_receivable();
  const message = await options.persist();
  options.accepted();
  if ("role" in message) {
    options.turn_context.input.observe_user_message(message);
    if (options.close_previous) await options.turn_context.output.assistant?.close_current_message();
  }
}

/** 一个 Turn 的内部输入暂存；只允许在完整 Step 的检查点消费其 Command。 */
export class SessionInternalInput {
  /** 尚未持久化的内部命令；落盘失败时保留，收口路径可重试持久化。 */
  private readonly pending = new Set<SessionCommand>();

  constructor(private readonly options: {
    /** 输入归属的 Turn。 */
    turn_id: string;
    /** 与排队 User 共用的 FIFO。 */
    queue: SessionQueue;
    /** 暂存前确认 Turn 仍接受输入。 */
    assert_receivable: () => void;
    /** 延迟读取已经装配完成的 Turn 上下文。 */
    get_context: () => SessionTurnContext;
  }) {}

  /** 暂存完成不代表已落盘；它保证当前 Turn 在结束前尝试提交，不提前关闭活跃 Step。 */
  stage(input: SessionTurnInboxInput): void {
    this.options.assert_receivable();
    const content = normalize_inbox_content(input.content);
    if (content.length === 0) return;
    const prepared: SessionInboxInput = structuredClone({ ...input, content, inbox_id: input.inbox_id ?? `inbox:${this.options.turn_id}:${nanoid()}` });
    const command: SessionCommand = {
      kind: "maintenance",
      interrupt: "defer",
      execute: async () => {
        // 已暂存输入即使随后 stop，也要在 Step 结束后保存事实；同一 ID 可安全重试。
        const assistant = this.options.get_context().output.assistant;
        if (!assistant) throw new Error("Session inbox requires an Assistant output writer");
        await assistant.append_inbox(prepared);
        this.pending.delete(command);
      },
    };
    this.pending.add(command);
    this.options.queue.enqueue_command(command);
  }

  /** 暂存输入也必须触发下一 Step，不能在最后一个 Tool 之后遗失。 */
  has_pending(): boolean { return this.pending.size > 0; }

  /** 仅在执行器已退出的失败/停止路径调用，保存已暂存输入，不重放其它命令。 */
  async flush(): Promise<void> {
    for (const command of this.pending) {
      this.options.queue.take(command);
      await command.execute();
    }
  }
}

/** 缺少权威 Turn 完成日志时的稳定错误，不推断消息片段的终态。 */
export function completion_unavailable(turn_id: string): Error & { code: string; turn_id: string } {
  return Object.assign(new Error(`Turn completion unavailable; execution outcome is unknown: ${turn_id}`), {
    code: "completion_unavailable",
    turn_id,
  });
}
