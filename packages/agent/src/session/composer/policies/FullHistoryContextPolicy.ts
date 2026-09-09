/**
 * 全量历史上下文策略。
 *
 * 该策略没有派生状态，适用于短会话、测试或拥有足够上下文窗口的模型。
 */

import { session_messages_to_model_messages } from "@/executor/messages/SessionModelMessages.js";
import type { SessionContextPolicy } from "@/types/session/SessionContextPolicy.js";

/** 直接把全部 canonical Message 转换为模型历史。 */
export class FullHistoryContextPolicy implements SessionContextPolicy {
  readonly name = "full_history";

  /** 全量历史策略不需要创建派生表。 */
  async initialize(): Promise<void> {}

  /** 按 canonical 顺序返回完整模型历史。 */
  async resolve(input: Parameters<SessionContextPolicy["resolve"]>[0]) {
    const messages = await input.storage.list_messages();
    return {
      messages: await session_messages_to_model_messages(messages, input.project_root),
      diagnostics: {
        policy_name: this.name,
        ...(messages.at(-1)?.sequence !== undefined
          ? { through_sequence: messages.at(-1)?.sequence }
          : {}),
        derived: false,
      },
    };
  }

  /** 没有派生状态，因此无法通过恢复改变上下文。 */
  async recover(): Promise<boolean> {
    return false;
  }
}
