/**
 * Skill Power 的宿主管理 actions。
 *
 * 关键点（中文）
 * - 权威数据是 Agent 技能目录 `agents/<agent-id>/skills`。
 * - 可关联来源只有用户目录 `~/.agents/skills`；不做 Workspace 维度，也不在界面里安装。
 * - 动作不依赖 Agent 运行实例，Agent 列表由宿主作为只读能力注入。
 */

import fs from "fs-extra";
import type { McpRuntime } from "@/mcp/Power.js";
import path from "node:path";
import { createHash as create_hash } from "node:crypto";
import type { PowerJsonValue, PowerLifecycleContext } from "@downcity/city/power";
import { listSkills } from "@/skill/Action.js";
import { resolveSkillPowerOptions } from "@/skill/Config.js";
import { assert_safe_agent_id, create_skill_root_context } from "@/skill/runtime/AgentRoot.js";
import type { SkillRootContext } from "@/skill/runtime/Paths.js";
import type { SkillSummary } from "@/skill/types/SkillCommand.js";
import type {
  SkillMainviewAvailableItem,
  SkillMainviewItem,
  SkillMainviewLinkInput,
  SkillMainviewMutationResult,
  SkillMainviewReadInput,
  SkillMainviewRemoveInput,
  SkillMainviewSnapshot,
} from "@/skill/types/SkillMainview.js";

/** 宿主动作运行所需的稳定路径事实。 */
export interface SkillPowerHostRuntime {
  /**
   * Agent 技能目录根，即 `<data_root_path>/agents`。
   */
  agents_root: string;
  /** Owned MCP service supplying safe summaries and persisted Agent assignments. */
  mcp_runtime: McpRuntime;
}

/** 注册 Skill Power 的宿主管理 actions。 */
export function register_skill_power_host_actions(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
): void {
  for (const assigned of [true, false]) {
    context.power.action({
      id: assigned ? "skill.mcp.assign" : "skill.mcp.unassign",
      run: async (input) => {
        const agent_id = read_required_string(input, "agent_id");
        const server_id = read_required_string(input, "server_id");
        if (!(await context.system.list_agents()).some((agent) => agent.agent_id === agent_id)) {
          throw new Error(`Unknown Agent: ${agent_id}`);
        }
        if (assigned && !(await runtime.mcp_runtime.snapshot_servers()).some((server) => server.id === server_id)) {
          throw new Error(`Unknown MCP server: ${server_id}`);
        }
        await runtime.mcp_runtime.assignments.set(agent_id, server_id, assigned);
        return as_json({ ...await create_snapshot(context, runtime), operation_success: true });
      },
    });
  }
  context.power.action({
    id: "skill.snapshot",
    run: async () => as_json(await create_snapshot(context, runtime)),
  });
  context.power.action({
    id: "skill.read_home",
    run: async (input) => as_json(await read_discovered_skill(
      list_home_skills(runtime), read_required_string(input, "skill_id"),
    )),
  });
  context.power.action({
    id: "skill.read",
    run: async (input) => as_json(await read_skill(runtime, read_read_input(input))),
  });
  context.power.action({
    id: "skill.link",
    run: async (input) => as_json(await link_skill(context, runtime, read_link_input(input))),
  });
  context.power.action({
    id: "skill.remove",
    run: async (input) =>
      as_json(await remove_skill(context, runtime, read_remove_input(input))),
  });
}

/**
 * 读取全部 Agent 及其已绑定 Skill，以及用户目录里可关联的 Skill。
 *
 * 关键点（中文）：Sidebar 与 Mainview 共用这一份快照；写操作后重算同一份结果，
 * 因此关联状态随操作一起刷新。
 */
async function create_snapshot(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
): Promise<SkillMainviewSnapshot> {
  const agents = await context.system.list_agents();
  const views = await Promise.all(agents.map(async (agent) => ({
    agent_id: agent.agent_id,
    name: agent.name,
    skills: list_agent_skills(runtime, agent.agent_id),
    mcp_server_ids: await runtime.mcp_runtime.assignments.read(agent.agent_id),
  })));

  const available = list_home_skills(runtime).map((skill) => to_available_item(skill, []));
  return {
    success: true,
    agents: views,
    mcp_servers: (await runtime.mcp_runtime.snapshot_servers()).map((server) => ({
      ...server,
      linked_agent_ids: views.filter((view) => view.mcp_server_ids.includes(server.id)).map((view) => view.agent_id),
    })),
    available: available.map((skill) => ({
      ...skill,
      linked_agent_ids: views
        .filter((view) => view.skills.some((bound) => bound.resource_id === skill.resource_id))
        .map((view) => view.agent_id),
    })),
  };
}

/** 读取用户目录中的全部 Skill。 */
function list_home_skills(runtime: SkillPowerHostRuntime): SkillSummary[] {
  return listSkills({
    scope: "home",
    context: create_home_context(runtime),
    options: resolveSkillPowerOptions(),
  }).skills;
}

/** 读取一个 Agent 技能目录下已绑定的 Skill。 */
function list_agent_skills(
  runtime: SkillPowerHostRuntime,
  agent_id: string,
): SkillMainviewItem[] {
  return listSkills({
    scope: "agent",
    context: create_agent_context(runtime, agent_id),
    options: resolveSkillPowerOptions(),
  }).skills.map(to_mainview_item);
}

/** 重新发现后读取一个 Skill，避免信任 Renderer 传入的本地路径。 */
async function read_skill(
  runtime: SkillPowerHostRuntime,
  input: SkillMainviewReadInput,
) {
  const skills = listSkills({
    scope: "agent",
    context: create_agent_context(runtime, input.agent_id),
    options: resolveSkillPowerOptions(),
  }).skills;
  return await read_discovered_skill(skills, input.skill_id);
}

/** 把用户目录中的 Skill 软链接进 Agent 技能目录。 */
async function link_skill(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
  input: SkillMainviewLinkInput,
): Promise<SkillMainviewMutationResult> {
  const skill = list_home_skills(runtime).find((item) => item.id === input.skill_id);
  if (!skill) {
    return {
      ...await create_snapshot(context, runtime),
      operation_success: false,
      error: `Skill not found in home directory: ${input.skill_id}`,
    };
  }

  const link_path = path.join(resolve_agent_skill_dir(runtime, input.agent_id), skill.id);
  try {
    await fs.ensureDir(path.dirname(link_path));
    // Exclusive creation preserves independent copies, existing links and undiscovered entries.
    await fs.symlink(skill.directory_path, link_path, "junction");
    return {
      ...await create_snapshot(context, runtime),
      operation_success: true,
    };
  } catch (reason) {
    return {
      ...await create_snapshot(context, runtime),
      operation_success: false,
      error: to_error_message(reason),
    };
  }
}

/**
 * 从 Agent 技能目录移除一个 Skill。
 *
 * 关键点（中文）：只删除 Agent 目录内的条目；软链接只删链接本身，不动用户目录。
 */
async function remove_skill(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
  input: SkillMainviewRemoveInput,
): Promise<SkillMainviewMutationResult> {
  const exists = list_agent_skills(runtime, input.agent_id)
    .some((skill) => skill.id === input.skill_id);
  if (!exists) {
    return {
      ...await create_snapshot(context, runtime),
      operation_success: false,
      error: `Skill not found: ${input.skill_id}`,
    };
  }

  try {
    await fs.remove(
      path.join(resolve_agent_skill_dir(runtime, input.agent_id), input.skill_id),
    );
    return {
      ...await create_snapshot(context, runtime),
      operation_success: true,
    };
  } catch (reason) {
    return {
      ...await create_snapshot(context, runtime),
      operation_success: false,
      error: to_error_message(reason),
    };
  }
}

/** 解析目标 Agent 的 Skill 目录，并拒绝非法 Agent ID。 */
function resolve_agent_skill_dir(
  runtime: SkillPowerHostRuntime,
  agent_id_input: string,
): string {
  const agent_id = String(agent_id_input || "").trim();
  assert_safe_agent_id(agent_id);
  return path.join(runtime.agents_root, agent_id, "skills");
}

/** 构造某个 Agent 的扫描上下文。 */
function create_agent_context(
  runtime: SkillPowerHostRuntime,
  agent_id: string,
): SkillRootContext {
  return create_skill_root_context({
    agent_skill_dir: resolve_agent_skill_dir(runtime, agent_id),
    agent_id,
    workspace_path: process.cwd(),
  });
}

/** 构造用户目录扫描上下文。 */
function create_home_context(runtime: SkillPowerHostRuntime): SkillRootContext {
  return create_skill_root_context({
    agent_skill_dir: "",
    agent_id: "",
    workspace_path: process.cwd(),
  });
}

/** 把内部摘要投影为已绑定列表条目。 */
function to_mainview_item(skill: SkillSummary): SkillMainviewItem {
  return {
    ...resource_identity(skill),
    id: skill.id,
    name: skill.name,
    description: skill.description,
    is_link: skill.is_link,
    ...(skill.link_target ? { link_target: skill.link_target } : {}),
    allowed_tools: [...skill.allowed_tools],
  };
}

/** 把内部摘要投影为可关联列表条目。 */
function to_available_item(
  skill: SkillSummary,
  linked_agent_ids: string[],
): SkillMainviewAvailableItem {
  return {
    ...resource_identity(skill),
    id: skill.id,
    name: skill.name,
    description: skill.description,
    linked_agent_ids,
  };
}

/** Resolve aliases to the actual resource; source paths are display-only renderer metadata. */
function resource_identity(skill: SkillSummary) {
  const canonical_path = fs.realpathSync(skill.directory_path);
  return {
    resource_id: create_hash("sha256").update(canonical_path).digest("hex"),
    source_path: skill.directory_path,
  };
}

/** Read only an exact discovered directory ID, never a renderer-provided path or fuzzy name. */
async function read_discovered_skill(skills: SkillSummary[], skill_id: string) {
  const target = skills.find((skill) => skill.id === skill_id);
  if (!target) return { success: false, error: `Skill not found: ${skill_id}` };
  try {
    return { success: true, content: await fs.readFile(target.skill_md_path, "utf-8") };
  } catch (reason) {
    return { success: false, error: to_error_message(reason) };
  }
}

/** 读取对象中的必填字符串。 */
function read_required_string(input: PowerJsonValue | undefined, key: string): string {
  const value = read_record(input)[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

/** 要求输入为 Power JSON object。 */
function read_record(value: PowerJsonValue | undefined): Record<string, PowerJsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Power action input must be an object");
  }
  return value as Record<string, PowerJsonValue>;
}

/** 解析 read 输入。 */
function read_read_input(input: PowerJsonValue | undefined): SkillMainviewReadInput {
  return {
    agent_id: read_required_string(input, "agent_id"),
    skill_id: read_required_string(input, "skill_id"),
  };
}

/** 解析关联输入。 */
function read_link_input(input: PowerJsonValue | undefined): SkillMainviewLinkInput {
  return {
    agent_id: read_required_string(input, "agent_id"),
    skill_id: read_required_string(input, "skill_id"),
  };
}

/** 解析删除输入。 */
function read_remove_input(input: PowerJsonValue | undefined): SkillMainviewRemoveInput {
  return {
    agent_id: read_required_string(input, "agent_id"),
    skill_id: read_required_string(input, "skill_id"),
  };
}

/** 把未知失败转换为稳定错误文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 把结构化协议显式收敛到 Power JSON 边界。 */
function as_json(value: unknown): PowerJsonValue {
  return value as PowerJsonValue;
}
