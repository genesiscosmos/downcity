/**
 * Agent instruction 组装工具。
 *
 * 关键点（中文）
 * - 这里只处理 Agent 身份、静态 instruction 与默认 core prompt。
 * - 顺序固定为 identity → instruction → core；core 不会被调用方 instruction 替代。
 * - identity 与 core 都由 SDK 注入，调用方 instruction 只决定中间一段。
 * - 不读取 Session、Power 或 runtime 状态，保持为纯函数。
 */

import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import { CORE_SYSTEM_PROMPT } from "@/model/prompts/SystemPromptAssets.js";

/** 构造 instruction system block 所需的 Agent 身份与调用方指令。 */
export interface CreateInstructionSystemBlocksInput {
  /** 当前 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Agent 的用户可见名称；为空时回退到 agent_id。 */
  agent_name: string;
  /** 调用方传入的静态 instruction，应已由 `normalize_instruction_input` 归一化。 */
  instruction: readonly string[];
}

/**
 * 归一化调用方传入的静态 instruction。
 */
export function normalize_instruction_input(
  input: string | string[] | undefined,
): string[] {
  const items = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? [input]
      : [];
  return items
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0);
}

/**
 * 渲染 Agent 身份说明。
 *
 * 关键点（中文）
 * - name 与 id 始终同时给出：name 是模型理解的角色名，id 是宿主可对账的稳定标识。
 * - name 缺省回退到 id，此时两者一致，仍然保持同一输出形状。
 */
function create_identity_content(input: {
  /** 当前 Agent 的稳定标识。 */
  agent_id: string;
  /** 当前 Agent 的用户可见名称。 */
  agent_name: string;
}): string {
  const agent_id = String(input.agent_id || "").trim();
  const agent_name = String(input.agent_name || "").trim() || agent_id;
  return [
    "# Agent Identity",
    "",
    `You are "${agent_name}" (agent id: ${agent_id}).`,
  ].join("\n");
}

/**
 * 构造进入 session system prompt 的 instruction block。
 *
 * 关键点（中文）
 * - 顺序为 identity → instruction → core。
 * - identity 复用 `instruction` 来源，但块名独立为 `identity`，便于消费端区分。
 */
export function create_instruction_system_blocks(
  input: CreateInstructionSystemBlocksInput,
): AgentSessionSystemBlock[] {
  const instruction_blocks = input.instruction.map((content, index) => ({
    source: "instruction" as const,
    name: input.instruction.length === 1 ? "agent" : `agent:${index + 1}`,
    content,
  }));
  return [
    {
      source: "instruction",
      name: "identity",
      content: create_identity_content(input),
    },
    ...instruction_blocks,
    {
      source: "core",
      name: "default",
      content: CORE_SYSTEM_PROMPT,
    },
  ];
}
