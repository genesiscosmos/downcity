/**
 * 默认 Session Composer。
 *
 * 负责把 Session 运行快照与 Context Policy 结果组装为最终模型输入。
 */

import { build_session_system_blocks } from "@/session/SessionSystem.js";
import type {
  SessionComposer,
  SessionComposeInput,
  SessionStepInput,
} from "@/types/session/SessionComposer.js";
import type { SessionContextPolicy } from "@/types/session/SessionContextPolicy.js";
import { AdaptivePartContextPolicy } from "@/session/composer/policies/AdaptivePartContextPolicy.js";
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

  /** 当前 Composer 使用的上下文策略。 */
  private readonly context_policy: SessionContextPolicy;

  constructor(options?: {
    /** 生成模型历史的上下文策略。 */
    context_policy?: SessionContextPolicy;
  }) {
    this.context_policy = options?.context_policy || new AdaptivePartContextPolicy();
  }

  /** 初始化内部 Context Policy 的派生 schema。 */
  async initialize(input: Parameters<SessionComposer["initialize"]>[0]): Promise<void> {
    await this.context_policy.initialize({
      storage: input.storage.composer_storage(this.context_policy.name),
    });
  }

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

    const context = await this.context_policy.resolve({
      storage: input.storage.composer_storage(this.context_policy.name),
      project_root: input.session.project_root,
    });
    system_blocks.push(...(context.system_blocks ?? []));
    return {
      system: system_blocks.map((block) => ({
        role: "system" as const,
        content: block.content,
      })),
      system_blocks,
      messages: inject_plugin_context(context.messages, input.state.plugin_context_blocks ?? []),
      tools: { ...input.state.tools },
      context_diagnostics: context.diagnostics,
    };
  }

  /** 把上下文恢复委托给当前 Policy。 */
  async recover_context(input: Parameters<SessionComposer["recover_context"]>[0]): Promise<boolean> {
    return await this.context_policy.recover({
      storage: input.storage.composer_storage(this.context_policy.name),
      project_root: input.session.project_root,
      reason: input.reason,
      model: input.model,
      on_model_request_failure: input.on_model_request_failure,
    });
  }
}
