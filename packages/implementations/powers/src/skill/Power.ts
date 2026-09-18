/**
 * Skill Power。
 *
 * 关键点（中文）
 * - skill 不再作为 service 存在，而是作为显式 action + system 提供者接入 power 体系。
 * - `find/install` action 只返回 Shell 操作提示，不执行命令或修改文件。
 * - `list/lookup` action 负责读取当前可发现的本地 skill。
 * - skills overview 文本通过 `power.system` 注入，不再依赖 power.system。
 */

import { Power } from "@downcity/city/power";
import { create_action } from "@downcity/city/power";
import { z } from "zod";
import type { PowerDefinition } from "@downcity/city/power";
import type { PowerJsonObject, PowerJsonValue, PowerLifecycleContext } from "@downcity/city/power";
import type { PowerActionResult } from "@downcity/city/power";
import type {
  SkillPowerFindPayload,
  SkillPowerInstallPayload,
  SkillPowerLookupPayload,
  SkillPowerOptions,
} from "@/skill/types/SkillPower.js";
import { SKILL_POWER_ACTIONS } from "@/skill/types/SkillPower.js";
import { resolveSkillPowerOptions } from "@/skill/Config.js";
import {
  listSkills,
  lookupSkill,
} from "@/skill/Action.js";
import { buildSkillsSystemText } from "@/skill/runtime/SystemProvider.js";
import {
  render_skill_find_prompt,
  render_skill_install_prompt,
} from "@/skill/runtime/Prompt.js";
import { SKILL_POWER_PROMPT } from "@/skill/SkillPromptAssets.js";
import { register_skill_power_host_actions } from "@/skill/host/SkillPowerHostActions.js";

/**
 * 读取 JSON object。
 */
function readJsonObject(value: PowerJsonValue): PowerJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid JSON body");
  }
  return value as PowerJsonObject;
}

/**
 * XML 属性转义。
 */
function sanitizeXmlAttr(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function createSkillPowerDefinition(options: SkillPowerOptions): PowerDefinition {
  return {
    name: "skill",
    title: "Skills",
    description:
      "Lists and reads local skills, and injects scan-aware discovery and installation guidance into system prompts.",
    async system(context, execution_context) {
      const dynamicText = String(
        await buildSkillsSystemText({
          rootPath: context.workspace.path,
          options,
        }, execution_context),
      ).trim();
      return [SKILL_POWER_PROMPT, dynamicText].filter(Boolean).join("\n\n");
    },
    actions: {
      [SKILL_POWER_ACTIONS.find]: create_action({
        description:
          "Return shell instructions for finding a skill. This action does not execute the search.",
        returns: "skill search instructions. Contains no search results: the caller must run the returned shell steps.",
        access: "read",
        input_schema: {
          zod: z.object({
            query: z.string().trim().min(1),
          }),
          json_schema: {
            type: "object",
            required: ["query"],
            properties: {
              query: {
                type: "string",
                description: "Skill search query.",
              },
            },
          },
        },
        examples: [
          {
            title: "Get skill search instructions",
            payload: { query: "web access" },
          },
        ],
        command: {
          description:
            "Return shell instructions for finding a skill without executing the search.",
          configure(command) {
            command.argument("<query>");
          },
          map_input({ args }): SkillPowerFindPayload {
            const query = String(args[0] || "").trim();
            if (!query) throw new Error("Missing query");
            return { query };
          },
        },
        execute(params): PowerActionResult<PowerJsonObject> {
          const payload = params.input as SkillPowerFindPayload;
          return {
            success: true,
            message: "Skill search instructions ready; no search was executed.",
            data: {
              kind: "instructions",
              query: payload.query,
              prompt: render_skill_find_prompt(payload.query),
            },
          };
        },
      }),
      [SKILL_POWER_ACTIONS.install]: create_action({
        description:
          "Return scan-aware shell instructions for installing a skill. This action does not install anything.",
        returns: "installation instructions with resolved scan roots. Installs nothing by itself.",
        access: "read",
        input_schema: {
          zod: z.object({
            spec: z.string().trim().min(1),
          }),
          json_schema: {
            type: "object",
            required: ["spec"],
            properties: {
              spec: {
                type: "string",
                description: "Skill installation source or spec.",
              },
            },
          },
        },
        examples: [
          {
            title: "Get skill installation instructions",
            payload: { spec: "owner/repository@skill-name" },
          },
        ],
        command: {
          description:
            "Return scan-aware shell instructions without installing a skill.",
          configure(command) {
            command.argument("<spec>");
          },
          map_input({ args }): SkillPowerInstallPayload {
            const spec = String(args[0] || "").trim();
            if (!spec) throw new Error("Missing spec");
            return { spec };
          },
        },
        execute(params): PowerActionResult<PowerJsonObject> {
          const payload = params.input as SkillPowerInstallPayload;
          return {
            success: true,
            message: "Skill installation instructions ready; no files were changed.",
            data: {
              kind: "instructions",
              spec: payload.spec,
              prompt: render_skill_install_prompt(
                params.context.workspace.path,
                options,
                payload.spec,
              ),
            },
          };
        },
      }),
      [SKILL_POWER_ACTIONS.list]: create_action({
        description: "List currently learned skills discoverable locally.",
        returns: "skills(name, description, path, root, source, discovered_at)",
        access: "read",
        input_schema: {
          zod: z.object({}).passthrough(),
          json_schema: {
            type: "object",
            properties: {},
          },
        },
        examples: [
          {
            title: "List skills",
            payload: {},
          },
        ],
        command: {
          description: "List currently learned skills discoverable locally.",
          map_input() {
            return {};
          },
        },
        api: {
          method: "GET",
        },
        execute(params): PowerActionResult<PowerJsonObject> {
          return {
            success: true,
            data: listSkills(params.context.workspace.path, options) as unknown as PowerJsonObject,
          };
        },
      }),
      [SKILL_POWER_ACTIONS.lookup]: create_action({
        description: "Read learned skill content (SKILL.md).",
        returns: "skill(name, description, path, content)",
        access: "read",
        input_schema: {
          zod: z.object({
            name: z.string(),
          }),
          json_schema: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string", description: "Skill name." },
            },
          },
        },
        examples: [
          {
            title: "Read skill",
            payload: { name: "web-search" },
          },
        ],
        command: {
          description: "Read learned skill content (SKILL.md).",
          configure(command) {
            command.argument("<name>");
          },
          map_input({ args }): SkillPowerLookupPayload {
            const name = String(args[0] || "").trim();
            if (!name) throw new Error("Missing name");
            return { name };
          },
        },
        api: {
          method: "POST",
          async map_input(c): Promise<SkillPowerLookupPayload> {
            const body = readJsonObject(await c.req.json());
            const name = String(body.name || "").trim();
            if (!name) throw new Error("Missing name");
            return { name };
          },
        },
        async execute(params): Promise<PowerActionResult<PowerJsonObject>> {
          const payload = params.input as SkillPowerLookupPayload;
          const result = await lookupSkill({
            project_root: params.context.workspace.path,
            request: {
              name: payload.name,
            },
            options,
          });
          if (!result.success) {
            return {
              success: false,
              error: result.error || "skill lookup failed",
            };
          }

          const skillName = String(result.skill?.name || result.skill?.id || "").trim();
          const openingTag = skillName
            ? `<skill name="${sanitizeXmlAttr(skillName)}">`
            : "<skill>";
          const skillUserMessage = [
            openingTag,
            String(result.content || "").trim(),
            "</skill>",
          ]
            .filter(Boolean)
            .join("\n")
            .trim();

          return {
            success: true,
            data: {
              success: true,
              ...(result.skill ? { skill: result.skill } : {}),
              message: "Skill content is ready. Next it will be injected as a `<skill>...</skill>` user message.",
              __ship: {
                injectUserMessages: [
                  {
                    text: skillUserMessage,
                    note: "skill_lookup",
                  },
                ],
                suppressToolOutput: true,
                toolOutputMessage:
                  "skill lookup success; content injected as <skill> user message.",
              },
            } as PowerJsonObject,
          };
        },
      }),
    },
  };
}

/**
 * SkillPower：技能发现、读取与扫描感知的 system 注入。
 */
export class SkillPower extends Power {
  readonly name = "skill";

  constructor(options: SkillPowerOptions = {}) {
    super();
    const resolvedOptions = resolveSkillPowerOptions(options);
    Object.assign(this, createSkillPowerDefinition(resolvedOptions));
  }

  /** 注册 Skill Power 的宿主管理 actions。 */
  initialize(context: PowerLifecycleContext): void {
    register_skill_power_host_actions(context);
  }
}
