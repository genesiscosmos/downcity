/**
 * City instruction 聚合模块。
 *
 * 负责将所有 service 的 instruction 与 action 定义汇总成统一文档。
 */

import {
  formatInstructionDocument,
  resolveInstruction,
  type InstructionSection,
} from "../service/instruction.js";
import type { Service } from "../service/service.js";

/**
 * 聚合 City 的 instruction 文档。
 */
export async function build_federation_instruction(services: Service[]): Promise<string> {
  const sections: InstructionSection[] = [];

  for (const service of services) {
    const actions = service._listInstructionActions();
    const body = await resolveInstruction(service.instruction, {
      id: service.id,
      name: service.name,
      env: service.env,
      actions,
    });

    sections.push({
      id: service.id,
      name: service.name,
      kind: "service",
      actions,
      env: service.env,
      body,
    });
  }

  return formatInstructionDocument({
    base: {
      builtin_services: ["env", "bureaus"],
      loaded_modules: sections.map((item) => item.id),
    },
    sections,
  });
}
