/**
 * 默认 Session Composer。
 *
 * 负责把 Session 的只读状态与 canonical Message 快照组装为模型输入；
 * 压缩只生成计划，实际 Segment 提交仍由 SessionMessages 负责。
 */

import { build_session_system_blocks } from "@/session/SessionSystem.js";
import { compose_session_compaction } from "@/session/messages/SessionMessageCompaction.js";
import { to_executor_history } from "@/session/messages/SessionMessageCodec.js";
import type {
  SessionComposer,
  SessionCompactionInput,
  SessionCompactionPlan,
  SessionComposeInput,
  SessionStepInput,
} from "@/types/session/SessionComposer.js";

/** 默认 Session 执行策略。 */
export class DefaultSessionComposer implements SessionComposer {
  readonly name = "default_session";

  /** 组装当前 Step 的 system、history 与 tools。 */
  async compose(input: SessionComposeInput): Promise<SessionStepInput> {
    const system_blocks = await build_session_system_blocks({
      agent_id: input.session.agent_id,
      project_root: input.session.project_root,
      session_id: input.session.session_id,
      created_at: input.session.created_at,
      timezone: input.session.timezone,
      get_instruction_system_blocks: () => [
        ...input.state.instruction_system_blocks,
      ],
      get_managed_plugin_system_blocks: async () => [
        ...input.state.managed_plugin_system_blocks,
      ],
      get_plugin_system_blocks: async () => [
        ...input.state.plugin_system_blocks,
      ],
    });

    return {
      system: system_blocks.map((block) => ({
        role: "system" as const,
        content: block.content,
      })),
      system_blocks,
      messages: to_executor_history(
        input.session.session_id,
        input.history,
      ),
      tools: { ...input.state.tools },
    };
  }

  /** 生成等待 SessionMessages 提交的压缩计划。 */
  async compact(
    input: SessionCompactionInput,
  ): Promise<SessionCompactionPlan | null> {
    if (!input.model) return null;
    return await compose_session_compaction({
      session_id: input.session.session_id,
      snapshot: input.history,
      model: input.model,
    });
  }

  /** 判断错误是否属于模型上下文超限。 */
  should_compact(error: unknown): boolean {
    const message = String(error ?? "");
    return (
      message.includes("context_length") ||
      message.includes("too long") ||
      message.includes("maximum context") ||
      message.includes("context window")
    );
  }
}
