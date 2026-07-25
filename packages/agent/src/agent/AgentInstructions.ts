/**
 * Agent instruction 组装工具。
 *
 * 关键点（中文）
 * - 这里只处理静态 instruction 与默认 core prompt。
 * - instruction 永远在 core 前面；core 不会被调用方 instruction 替代。
 * - 不读取 session、plugin 或 runtime 状态，保持为纯函数。
 */

import type { AgentSessionSystemBlock } from "@/types/agent/SessionTypes.js";
import { DEFAULT_SHIP_PROMPTS } from "@executor/composer/system/default/SystemDomain.js";

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

function createCoreInstructionContent(project_root: string): string {
  const current_year = String(new Date().getFullYear());
  return DEFAULT_SHIP_PROMPTS
    .replaceAll("{{project_path}}", project_root)
    .replaceAll("{{project_root}}", project_root)
    .replaceAll("{{current_year}}", current_year);
}

/**
 * 构造进入 session system prompt 的 instruction block。
 */
export function create_instruction_system_blocks(
  instruction: string[],
  project_root: string,
): AgentSessionSystemBlock[] {
  const instruction_blocks = instruction.map((content, index) => ({
    source: "instruction" as const,
    name: instruction.length === 1 ? "agent" : `agent:${index + 1}`,
    content,
  }));
  return [
    ...instruction_blocks,
    {
      source: "core",
      name: "default",
      content: createCoreInstructionContent(project_root),
    },
  ];
}
