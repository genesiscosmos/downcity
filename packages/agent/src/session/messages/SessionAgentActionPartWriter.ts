/**
 * 单个 canonical Action Part 的生命周期写入器。
 *
 * Writer 只保存目标 Message 身份与发布策略，实际状态仍由 SessionMessages
 * 持久化和接受，避免形成第二份 Action 状态。
 */

import type { SessionMessages } from "@/session/SessionMessages.js";
import type { CompleteSessionAgentActionPartInput } from "@/types/session/SessionMessages.js";

/** 单个 Action Part 的生命周期 writer。 */
export class SessionAgentActionPartWriter {
  /** 当前 Action Part 所属 Agent Message 的稳定标识。 */
  readonly message_id: string;
  private readonly messages: SessionMessages;
  private readonly publish_mutation: boolean;
  private closed = false;

  constructor(
    messages: SessionMessages,
    message_id: string,
    publish_mutation = true,
  ) {
    this.messages = messages;
    this.message_id = message_id;
    this.publish_mutation = publish_mutation;
  }

  /** 把 Action 更新为 completed。 */
  async complete(input?: CompleteSessionAgentActionPartInput): Promise<void> {
    if (this.closed) return;
    await this.messages.update_action_part(
      this.message_id,
      "completed",
      input,
      { publish_mutation: this.publish_mutation },
    );
    this.closed = true;
  }

  /** 把 Action 更新为 failed。 */
  async fail(error: unknown): Promise<void> {
    if (this.closed) return;
    await this.messages.update_action_part(
      this.message_id,
      "failed",
      {
        description: error instanceof Error ? error.message : String(error),
      },
      { publish_mutation: this.publish_mutation },
    );
    this.closed = true;
  }
}
