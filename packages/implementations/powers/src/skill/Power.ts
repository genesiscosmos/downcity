/**
 * Skill Power。
 *
 * 关键点（中文）
 * - Skill 按 Agent 划分：权威来源是 `~/.downcity/agents/<agent-id>/skills`。
 * - `list` / `lookup` 读取技能；`servers` / `tools` / `call` 使用当前 Agent 分配的 MCP。
 * - 安装与关联：模型可以自己装进自己的技能目录，用户也可以在 Skills 页面操作。
 * - skills overview 通过 `power.system` 注入，清单与 `list` 默认结果保持一致。
 */

import { Power, create_action } from "@downcity/city/power";
import type {
  PowerActions,
  PowerContext,
  PowerJsonObject,
  PowerLifecycleContext,
} from "@downcity/city/power";
import type { PowerActionResult } from "@downcity/city/power";
import { z } from "zod";
import type {
  SkillPowerListPayload,
  SkillPowerLookupPayload,
  SkillPowerOptions,
  ResolvedSkillPowerOptions,
  SkillPowerScope,
} from "@/skill/types/SkillPower.js";
import { SKILL_POWER_ACTIONS } from "@/skill/types/SkillPower.js";
import { resolveSkillPowerOptions } from "@/skill/Config.js";
import { listSkills, lookupSkill } from "@/skill/Action.js";
import {
  create_skill_root_context,
  resolve_agent_skill_dir,
  resolve_agents_root,
} from "@/skill/runtime/AgentRoot.js";
import { build_skills_system_text } from "@/skill/runtime/SystemProvider.js";
import { SKILL_POWER_PROMPT } from "@/skill/SkillPromptAssets.js";
import { McpRuntime } from "@/mcp/runtime/McpRuntime.js";
import { register_skill_power_host_actions } from "@/skill/host/SkillPowerHostActions.js";

/** 读取一个可选的作用域参数。 */
function read_scope(value: unknown): SkillPowerScope {
  return value === "project" || value === "home" || value === "all" ? value : "agent";
}

/** 作用域参数的 JSON Schema。 */
const scope_json_schema = {
  type: "string",
  enum: ["agent", "project", "home", "all"],
  description:
    "Skill scope. agent (default) reads this agent's own skill directory; project reads the workspace .agents/skills; home reads ~/.agents/skills; all returns the union with agent winning conflicts.",
};

/** 构造 Skill Power 的完整动作集合。 */
function create_skill_power_actions(input: {
  /**
   * 读取当前 Agent 的技能目录。
   *
   * 关键点（中文）：数据根由每次调用的 context 提供，而动作在构造期就已装配，
   * 因此这里传一个从 context 取值的函数，避免闭包捕获构造期的空值。
   */
  get_agent_skill_dir: (data_root_path: string, agent_id: string) => string;
  /**
   * 归一化后的 power 选项。
   */
  options: ResolvedSkillPowerOptions;
}): PowerActions {
  const options = input.options;

  return {
    [SKILL_POWER_ACTIONS.list]: create_action({
      description: "List skills visible to this agent.",
      returns: "skills(id, name, description, source, is_link, link_target, allowed_tools)",
      access: "read",
      input_schema: {
        zod: z.object({ scope: z.string().optional() }).passthrough(),
        json_schema: {
          type: "object",
          properties: { scope: scope_json_schema },
        },
      },
      examples: [
        { title: "List this agent's skills", payload: {} },
        { title: "List project skills", payload: { scope: "project" } },
      ],
      command: {
        description: "List skills visible to this agent.",
        map_input({ args }): SkillPowerListPayload {
          return { ...(args[0] ? { scope: read_scope(args[0]) } : {}) };
        },
      },
      api: { method: "GET" },
      execute(params): PowerActionResult<PowerJsonObject> {
        const payload = params.input as SkillPowerListPayload;
        return {
          success: true,
          data: listSkills({
            scope: read_scope(payload.scope),
            context: create_skill_root_context({
              agent_skill_dir: input.get_agent_skill_dir(
                params.context.data_root_path,
                params.context.agent.id,
              ),
              agent_id: params.context.agent.id,
              workspace_path: params.context.workspace?.path,
            }),
            options,
          }) as unknown as PowerJsonObject,
        };
      },
    }),
    [SKILL_POWER_ACTIONS.lookup]: create_action({
      description: "Read skill content (SKILL.md).",
      returns: "skill(name, description, path) plus the SKILL.md body injected as a context message.",
      access: "read",
      input_schema: {
        zod: z.object({ name: z.string().trim().min(1), scope: z.string().optional() }),
        json_schema: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", description: "Skill name or directory id." },
            scope: scope_json_schema,
          },
        },
      },
      examples: [
        { title: "Read a skill", payload: { name: "web-access" } },
      ],
      command: {
        description: "Read skill content (SKILL.md).",
        configure(command) {
          command.argument("<name>");
          command.argument("[scope]");
        },
        map_input({ args }): SkillPowerLookupPayload {
          const name = String(args[0] || "").trim();
          if (!name) throw new Error("Missing name");
          return { name, ...(args[1] ? { scope: read_scope(args[1]) } : {}) };
        },
      },
      api: {
        method: "POST",
        async map_input(context): Promise<SkillPowerLookupPayload> {
          const body = await context.req.json();
          if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw new Error("Invalid JSON body");
          }
          const record = body as Record<string, unknown>;
          const name = String(record.name || "").trim();
          if (!name) throw new Error("Missing name");
          return { name, ...(record.scope ? { scope: read_scope(record.scope) } : {}) };
        },
      },
      async execute(params): Promise<PowerActionResult<PowerJsonObject>> {
        const payload = params.input as SkillPowerLookupPayload;
        const result = await lookupSkill({
          scope: read_scope(payload.scope),
          context: create_skill_root_context({
            agent_skill_dir: input.get_agent_skill_dir(
              params.context.data_root_path,
              params.context.agent.id,
            ),
            agent_id: params.context.agent.id,
            workspace_path: params.context.workspace?.path,
          }),
          options,
          request: { name: payload.name },
        });
        if (!result.success || !result.skill || !result.content) {
          return {
            success: false,
            error: result.error || "skill lookup failed",
          };
        }

        const skill = result.skill;
        return {
          success: true,
          message: `Loaded skill "${skill.name}". Its content is injected as a context message for this turn.`,
          data: {
            success: true,
            skill,
          } as unknown as PowerJsonObject,
          messages: [
            {
              role: "user",
              parts: [
                {
                  type: "context",
                  tag: "skill",
                  context: [
                    `name: ${skill.name}`,
                    `id: ${skill.id}`,
                    `path: ${skill.skill_md_path}`,
                    "",
                    result.content,
                  ].join("\n"),
                },
              ],
            },
          ],
        };
      },
    }),
  };
}

/**
 * SkillPower：按 Agent 划分的技能发现、读取与 system 注入。
 */
export class SkillPower extends Power {
  /** MCP connections, configuration and assignments owned by this single Power. */
  private readonly mcp_runtime = new McpRuntime();
  /** Power 稳定名称，即模型侧工具名。 */
  readonly name = "skill";

  /** Power 用户可见标题。 */
  readonly title = "Skills";

  /** Power 用途说明。 */
  readonly description =
    "Lists and reads assigned skills, injects skill inventory, and discovers and calls assigned MCP servers through servers, tools, and call.";

  /** 构造期解析后的选项。 */
  private readonly options: ResolvedSkillPowerOptions;

  /** 当前 power 的完整动作集合。 */
  readonly actions: PowerActions;

  constructor(options: SkillPowerOptions = {}) {
    super();
    this.options = resolveSkillPowerOptions(options);
    this.actions = create_skill_power_actions({
      get_agent_skill_dir: resolve_agent_skill_dir,
      options: this.options,
    });
  }

  /** 合并静态提示与当前 Agent 可用技能说明。 */
  async system(context: PowerContext): Promise<string> {
    const dynamic_text = String(
      build_skills_system_text({
        context: create_skill_root_context({
          agent_skill_dir: resolve_agent_skill_dir(context.data_root_path, context.agent.id),
          agent_id: context.agent.id,
          workspace_path: context.workspace?.path,
        }),
        options: this.options,
      }),
    ).trim();
    return [SKILL_POWER_PROMPT, this.mcp_runtime.system(), dynamic_text].filter(Boolean).join("\n\n");
  }

  /** 注册 Skill Power 的宿主管理 actions。 */
  async initialize(context: PowerLifecycleContext): Promise<void> {
    await this.mcp_runtime.initialize(context);
    Object.assign(this.actions, this.mcp_runtime.actions);
    register_skill_power_host_actions(context, {
      agents_root: resolve_agents_root(context.data_root_path),
      mcp_runtime: this.mcp_runtime,
    });
  }

  /** Close all owned MCP connections and pending OAuth sessions. */
  async dispose(): Promise<void> {
    await this.mcp_runtime.dispose();
  }
}
