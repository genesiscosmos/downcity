/**
 * Composer 共用的组装原语。
 *
 * 本模块只做无状态的纯组装：把已冻结的 Step 状态转成 system blocks，并把 Power 动态
 * 参考内容注入模型消息副本。所有内置 Composer 都复用这里，避免各自复制 system 与
 * Power 拼接逻辑。
 */

import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import type { SessionHookContextBlock } from "@downcity/type";
import type { SessionComposeInput } from "@/types/session/SessionComposer.js";
import type { SessionSystemMessage } from "@/types/session/SessionPrompts.js";
import type { ModelMessage } from "@downcity/type";
import { build_session_system_blocks } from "@/session/input/SessionSystem.js";

/** 把当前 Step 生效的 instruction 与 Power blocks 组装成 system blocks。 */
export async function build_composer_system_blocks(
  input: SessionComposeInput,
): Promise<AgentSessionSystemBlock[]> {
  return await build_session_system_blocks({
    agent_id: input.session.agent_id,
    project_root: input.session.project_root,
    session_id: input.session.session_id,
    created_at: input.session.created_at,
    timezone: input.session.timezone,
    get_instruction_system_blocks: () => [
      ...(input.state.instruction_system_blocks ?? []),
    ],
    get_power_system_blocks: async () => [
      ...(input.state.power_system_blocks ?? []),
    ],
  });
}

/** 把 system blocks 投影为模型 system messages。 */
export function to_system_messages(
  blocks: readonly AgentSessionSystemBlock[],
): SessionSystemMessage[] {
  return blocks.map((block) => ({
    role: "system" as const,
    content: block.content,
  }));
}

/** 把低权限 Power 内容渲染为与用户原文分离的模型参考区。 */
export function render_power_context_blocks(
  blocks: readonly SessionHookContextBlock[],
): string {
  return blocks.map((block) => [
    `<extension-context extension="${escape_xml_attribute(block.source_power)}" name="${escape_xml_attribute(block.name)}" trust="reference">`,
    block.content,
    "</extension-context>",
  ].join("\n")).join("\n\n");
}

/** 只修改模型消息副本，把动态参考信息前置到当前最后一条 User Message。 */
export function inject_power_context(
  messages: ModelMessage[],
  blocks: readonly SessionHookContextBlock[],
): ModelMessage[] {
  if (blocks.length === 0) return messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
    messages[index] = {
      ...message,
      content: [{ type: "text", text: render_power_context_blocks(blocks) }, ...message.content],
    };
    break;
  }
  return messages;
}

/** 转义模型上下文标签属性，避免 Power 名称破坏边界。 */
function escape_xml_attribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
