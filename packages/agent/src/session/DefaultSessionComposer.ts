/**
 * 默认 Session Composer。
 *
 * 负责把 Session 的只读状态与 canonical Message 快照组装为模型输入；
 * 压缩只生成计划，实际 Segment 提交仍由 SessionMessages 负责。
 */

import { build_session_system_blocks } from "@/session/SessionSystem.js";
import { compose_session_compaction } from "@/session/messages/SessionMessageCompaction.js";
import { session_context_to_model_messages } from "@executor/messages/SessionModelMessages.js";
import type {
  SessionComposer,
  SessionCompactionInput,
  SessionCompactionPlan,
  SessionComposeInput,
  SessionStepInput,
} from "@/types/session/SessionComposer.js";
import type { SessionHookContextBlock } from "@downcity/type";
import type { ModelMessage } from "@downcity/type";

/** 把低权限 Plugin 内容渲染为与用户原文分离的模型参考区。 */
function render_plugin_context_blocks(
  blocks: readonly SessionHookContextBlock[],
): string {
  return blocks.map((block) => [
    `<extension-context extension="${escape_xml_attribute(block.source_plugin)}" name="${escape_xml_attribute(block.name)}" trust="reference">`,
    block.content,
    "</extension-context>",
  ].join("\n")).join("\n\n");
}

/** 转义模型上下文标签属性，避免 Plugin 名称破坏边界。 */
function escape_xml_attribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** 只修改模型消息副本，把动态参考信息前置到当前最后一条 User Message。 */
function inject_plugin_context(
  messages: ModelMessage[],
  blocks: readonly SessionHookContextBlock[],
): ModelMessage[] {
  if (blocks.length === 0) return messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
    messages[index] = {
      ...message,
      content: [{ type: "text", text: render_plugin_context_blocks(blocks) }, ...message.content],
    };
    break;
  }
  return messages;
}

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
        ...(input.state.instruction_system_blocks ?? []),
      ],
      get_managed_plugin_system_blocks: async () => [
        ...(input.state.managed_plugin_system_blocks ?? []),
      ],
      get_plugin_system_blocks: async () => [
        ...(input.state.plugin_system_blocks ?? []),
      ],
    });

    const messages = await session_context_to_model_messages(
      input.history,
      input.session.project_root,
    );
    return {
      system: system_blocks.map((block) => ({
        role: "system" as const,
        content: block.content,
      })),
      system_blocks,
      messages: inject_plugin_context(messages, input.state.plugin_context_blocks ?? []),
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
      on_model_request_failure: input.on_model_request_failure,
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
