/**
 * Skill Power 的宿主管理 actions。
 *
 * 宿主界面通过这些 Power 级动作浏览 Agent、读取、安装、关联和删除 Skill。
 * 权威数据是 Agent 私有目录 `agents/<agent-id>`；用户目录与各 Workspace 的
 * `.agents/skills` 只作为可关联来源出现在全局目录里。
 * 动作不依赖 Agent 运行实例，Agent 与 Workspace 列表由宿主作为只读能力注入。
 */

import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import type { PowerJsonValue, PowerLifecycleContext } from "@downcity/city/power";
import { listSkills, lookupSkill } from "@/skill/Action.js";
import { resolveSkillPowerOptions } from "@/skill/Config.js";
import { create_skill_root_context } from "@/skill/runtime/AgentRoot.js";
import { resolve_skill_root, type SkillRootContext } from "@/skill/runtime/Paths.js";
import type { SkillSummary } from "@/skill/types/SkillCommand.js";
import type {
  SkillMainviewCatalogItem,
  SkillMainviewInstallInput,
  SkillMainviewItem,
  SkillMainviewLinkInput,
  SkillMainviewMutationResult,
  SkillMainviewOrigin,
  SkillMainviewReadInput,
  SkillMainviewRemoveInput,
  SkillMainviewScope,
  SkillMainviewSearchHit,
  SkillMainviewSearchResult,
  SkillMainviewSnapshot,
} from "@/skill/types/SkillMainview.js";

/** 宿主动作运行所需的稳定路径事实。 */
export interface SkillPowerHostRuntime {
  /**
   * Agent 私有 skill 根目录绝对路径。
   */
  agent_root: string;
}

/** 一次宿主查询的公共输入。 */
interface AgentQuery {
  /**
   * 目标 Agent 稳定标识。
   */
  agent_id: string;
}

/** 注册 Skill Power 的宿主管理 actions。 */
export function register_skill_power_host_actions(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
): void {
  context.power.action({
    id: "skill.snapshot",
    run: async () => as_json(await create_snapshot(context, runtime)),
  });
  context.power.action({
    id: "skill.catalog",
    run: async (input) =>
      as_json(await read_catalog(context, runtime, read_agent_query(input))),
  });
  context.power.action({
    id: "skill.read",
    run: async (input) => as_json(await read_skill(context, runtime, read_read_input(input))),
  });
  context.power.action({
    id: "skill.install",
    run: async (input) => as_json(await install_skill(context, runtime, read_install_input(input))),
  });
  context.power.action({
    id: "skill.link",
    run: async (input) => as_json(await link_skill(context, runtime, read_link_input(input))),
  });
  context.power.action({
    id: "skill.remove",
    run: async (input) => as_json(await remove_skill(context, runtime, read_remove_input(input))),
  });
  context.power.action({
    id: "skill.search",
    run: async (input) => as_json(await search_catalog(read_required_string(input, "query"))),
  });
}

/** 读取全部 Agent 及其已绑定 Skill。 */
async function create_snapshot(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
): Promise<SkillMainviewSnapshot> {
  const agents = await context.system.list_agents();
  const origins = await list_catalog_origins(context, runtime, "");
  return {
    success: true,
    agents: agents.map((agent) => ({
      agent_id: agent.agent_id,
      name: agent.name,
      directory: describe_agent_skill_dir(runtime, agent.agent_id),
      skills: list_agent_skills(runtime, agent.agent_id, origins),
    })),
    catalog: [],
  };
}

/** 读取一个 Agent 私有目录下已绑定的 Skill。 */
function list_agent_skills(
  runtime: SkillPowerHostRuntime,
  agent_id: string,
  origins: CatalogOrigin[],
): SkillMainviewItem[] {
  return listSkills({
    scope: "agent",
    context: create_host_context(runtime, agent_id, process.cwd()),
    options: resolveSkillPowerOptions(),
  }).skills.map((skill) => to_mainview_item(skill, resolve_link_origin(skill, origins)));
}

/**
 * 读取全局目录，并标出每个 Skill 是否已关联到目标 Agent。
 *
 * 说明（中文）
 * - 来源是用户目录与宿主登记的全部 Workspace，不包含其它 Agent 的私有目录。
 */
async function read_catalog(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
  query: AgentQuery,
): Promise<SkillMainviewSnapshot> {
  const origins = await list_catalog_origins(context, runtime, query.agent_id);
  const snapshot = await create_snapshot(context, runtime);
  const agents = snapshot.agents.map((item) =>
    item.agent_id === query.agent_id
      ? { ...item, skills: list_agent_skills(runtime, query.agent_id, origins) }
      : item,
  );
  const linked_ids = new Set(
    (agents.find((item) => item.agent_id === query.agent_id)?.skills ?? [])
      .map((skill) => skill.id),
  );

  const catalog: SkillMainviewCatalogItem[] = [];
  for (const entry of origins) {
    for (const skill of list_skills_in_origin(runtime, query.agent_id, entry)) {
      catalog.push({
        ...to_mainview_item(skill),
        origin: entry.origin,
        linked: linked_ids.has(skill.id),
      });
    }
  }

  return { ...snapshot, agents, catalog };
}

/** 一个可关联来源及其解析后的扫描根。 */
interface CatalogOrigin {
  /**
   * 来源标识。
   */
  origin: SkillMainviewOrigin;
  /**
   * 该来源的绝对扫描根。
   */
  root: string;
  /**
   * 解析该来源所需的路径上下文。
   */
  context: SkillRootContext;
}

/**
 * 列出全部可关联来源。
 *
 * 关键点（中文）：空 `agent_id` 只用于解析根路径，不参与发现；
 * 因此 home 与 project 根都能在不依赖具体 Agent 的前提下拿到。
 */
async function list_catalog_origins(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
  agent_id: string,
): Promise<CatalogOrigin[]> {
  const workspaces = await context.system.list_workspaces();
  const origins: CatalogOrigin[] = workspaces.map((workspace) => {
    const workspace_context = create_host_context(runtime, agent_id, workspace.workspace_path);
    return {
      origin: {
        source: "project",
        workspace_id: workspace.workspace_id,
        workspace_name: workspace.name,
      },
      root: resolve_skill_root("project", workspace_context)?.resolved ?? "",
      context: workspace_context,
    };
  });

  const home_context = create_host_context(runtime, agent_id, process.cwd());
  origins.push({
    origin: { source: "home" },
    root: resolve_skill_root("home", home_context)?.resolved ?? "",
    context: home_context,
  });

  return origins;
}

/** 读取一个来源内的 Skill。 */
function list_skills_in_origin(
  runtime: SkillPowerHostRuntime,
  agent_id: string,
  entry: CatalogOrigin,
): SkillSummary[] {
  return listSkills({
    scope: entry.origin.source,
    context: entry.context,
    options: resolveSkillPowerOptions(),
  }).skills;
}

/**
 * 由软链接目标反推外部来源。
 *
 * 关键点（中文）
 * - 只根据已登记来源的扫描根判断，不信任任何由 Renderer 传入的路径。
 * - 链接目标来自 `realpath`，因此比较前也要把根路径归一化，否则 macOS 上
 *   `/var` 与 `/private/var` 这类等价路径会被判成不同目录。
 */
function resolve_link_origin(
  skill: SkillSummary,
  origins: CatalogOrigin[],
): SkillMainviewOrigin | undefined {
  const target = String(skill.link_target || "").trim();
  if (!target) return undefined;
  for (const entry of origins) {
    if (!entry.root) continue;
    const relative = path.relative(real_path_or_self(entry.root), target);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return entry.origin;
    }
  }
  return undefined;
}

/** 读取真实路径；路径不存在时原样返回。 */
function real_path_or_self(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.normalize(value);
  }
}

/** 重新发现后读取一个 Skill，避免信任 Renderer 传入的本地路径。 */
async function read_skill(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
  input: SkillMainviewReadInput,
) {
  return await lookupSkill({
    scope: input.scope,
    context: await resolve_read_context(context, runtime, input),
    options: resolveSkillPowerOptions(),
    request: { name: input.skill_id },
  });
}

/** 解析一次读取所需的路径上下文。 */
async function resolve_read_context(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
  input: { agent_id: string; scope: "agent" | SkillMainviewScope; workspace_id?: string },
): Promise<SkillRootContext> {
  if (input.scope === "agent") {
    return create_host_context(runtime, input.agent_id, process.cwd());
  }

  const origins = await list_catalog_origins(context, runtime, input.agent_id);
  const entry = origins.find((item) =>
    item.origin.source === input.scope &&
    (input.scope === "home" || item.origin.workspace_id === input.workspace_id));
  if (!entry) {
    throw new Error(
      input.scope === "home"
        ? "Home skill directory is unavailable"
        : `Workspace not found: ${input.workspace_id ?? ""}`,
    );
  }
  return entry.context;
}

/**
 * 用官方 skills CLI 安装一个 Skill 到目标 Agent 目录。
 *
 * 关键点（中文）
 * - CLI 只支持安装到项目或用户目录，因此先装到临时目录，再复制进 Agent 目录。
 * - 全程在 power 进程执行，不依赖沙箱 HOME，也不要求模型自己跑命令。
 */
async function install_skill(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
  input: SkillMainviewInstallInput,
): Promise<SkillMainviewMutationResult> {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-skill-install-"));
  try {
    const result = await run_skills_cli(["add", input.spec, "-y"], staging, 10 * 60_000);
    if (!result.success) {
      return {
        ...await create_snapshot(context, runtime),
        operation_success: false,
        error: result.error,
      };
    }

    const installed = find_staged_skill(staging);
    if (!installed) {
      return {
        ...await create_snapshot(context, runtime),
        operation_success: false,
        error: `Installed skill directory was not found after running the skills CLI for ${input.spec}`,
      };
    }

    const target_root = resolve_agent_skill_dir(runtime, input.agent_id);
    const target_dir = path.join(target_root, path.basename(installed));
    await fs.ensureDir(target_root);
    await fs.remove(target_dir);
    await fs.copy(installed, target_dir);
    return { ...await create_snapshot(context, runtime), operation_success: true };
  } catch (reason) {
    return {
      ...await create_snapshot(context, runtime),
      operation_success: false,
      error: to_error_message(reason),
    };
  } finally {
    await fs.remove(staging).catch(() => undefined);
  }
}

/** 在临时目录里定位 CLI 实际写出的 Skill 目录。 */
function find_staged_skill(staging: string): string | null {
  const candidates: string[] = [];
  const walk = (directory: string, depth: number): void => {
    if (depth > 4) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const full_path = path.join(directory, entry.name);
      if (fs.existsSync(path.join(full_path, "SKILL.md"))) {
        candidates.push(full_path);
        continue;
      }
      walk(full_path, depth + 1);
    }
  };
  walk(staging, 0);
  return candidates[0] ?? null;
}

/** 把用户目录或 Workspace 中的 Skill 软链接进 Agent 目录。 */
async function link_skill(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
  input: SkillMainviewLinkInput,
): Promise<SkillMainviewMutationResult> {
  const origins = await list_catalog_origins(context, runtime, input.agent_id);
  const entry = origins.find((item) =>
    item.origin.source === input.scope &&
    (input.scope === "home" || item.origin.workspace_id === input.workspace_id));
  if (!entry) {
    return {
      ...await read_catalog(context, runtime, { agent_id: input.agent_id }),
      operation_success: false,
      error: input.scope === "home"
        ? "Home skill directory is unavailable"
        : `Workspace not found: ${input.workspace_id ?? ""}`,
    };
  }

  const skill = list_skills_in_origin(runtime, input.agent_id, entry)
    .find((item) => item.id === input.skill_id);
  if (!skill) {
    return {
      ...await read_catalog(context, runtime, { agent_id: input.agent_id }),
      operation_success: false,
      error: `Skill not found in ${input.scope}: ${input.skill_id}`,
    };
  }

  const target_root = resolve_agent_skill_dir(runtime, input.agent_id);
  const link_path = path.join(target_root, skill.id);
  try {
    await fs.ensureDir(target_root);
    await fs.remove(link_path);
    await fs.symlink(skill.directory_path, link_path, "junction");
    return {
      ...await read_catalog(context, runtime, { agent_id: input.agent_id }),
      operation_success: true,
    };
  } catch (reason) {
    return {
      ...await read_catalog(context, runtime, { agent_id: input.agent_id }),
      operation_success: false,
      error: to_error_message(reason),
    };
  }
}

/**
 * 从 Agent 目录移除一个 Skill。
 *
 * 关键点（中文）：只删除 Agent 目录内的条目；软链接只删链接本身，不动目标目录。
 */
async function remove_skill(
  context: PowerLifecycleContext,
  runtime: SkillPowerHostRuntime,
  input: SkillMainviewRemoveInput,
): Promise<SkillMainviewMutationResult> {
  const origins = await list_catalog_origins(context, runtime, input.agent_id);
  const exists = list_agent_skills(runtime, input.agent_id, origins)
    .some((skill) => skill.id === input.skill_id);
  if (!exists) {
    return {
      ...await read_catalog(context, runtime, { agent_id: input.agent_id }),
      operation_success: false,
      error: `Skill not found: ${input.skill_id}`,
    };
  }

  try {
    await fs.remove(path.join(resolve_agent_skill_dir(runtime, input.agent_id), input.skill_id));
    return {
      ...await read_catalog(context, runtime, { agent_id: input.agent_id }),
      operation_success: true,
    };
  } catch (reason) {
    return {
      ...await read_catalog(context, runtime, { agent_id: input.agent_id }),
      operation_success: false,
      error: to_error_message(reason),
    };
  }
}

/** 使用官方 skills CLI 搜索公开目录。 */
async function search_catalog(query: string): Promise<SkillMainviewSearchResult> {
  const cwd = path.join(os.tmpdir(), "downcity-skills-search");
  await fs.ensureDir(cwd);
  const result = await run_skills_cli(["find", query], cwd, 120_000);
  if (!result.success) {
    return { success: false, query, hits: [], error: result.error };
  }
  return { success: true, query, hits: parse_search_hits(result.output) };
}

/** 解析目标 Agent 的 Skill 目录，并拒绝非法 Agent ID。 */
function resolve_agent_skill_dir(
  runtime: SkillPowerHostRuntime,
  agent_id_input: string,
): string {
  const agent_id = String(agent_id_input || "").trim();
  if (!agent_id) throw new Error("agent_id is required for agent skills");
  if (agent_id.includes("/") || agent_id.includes("\\") || path.isAbsolute(agent_id)) {
    throw new Error(`Invalid agent_id: ${agent_id}`);
  }
  return path.join(runtime.agent_root, agent_id);
}

/** 把 Agent Skill 目录折叠为带 `~` 的展示路径。 */
function describe_agent_skill_dir(
  runtime: SkillPowerHostRuntime,
  agent_id: string,
): string {
  return collapse_home(resolve_agent_skill_dir(runtime, agent_id));
}

/** 把绝对路径中的用户目录折叠为 `~`，用于稳定展示。 */
function collapse_home(value: string): string {
  const home = os.homedir();
  const normalized = path.normalize(value);
  const relative = path.relative(home, normalized);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return normalized;
  return relative ? `~/${relative}` : "~";
}

/** 构造宿主侧的扫描上下文。 */
function create_host_context(
  runtime: SkillPowerHostRuntime,
  agent_id: string,
  workspace_path: string,
): SkillRootContext {
  return create_skill_root_context({
    agent_root: runtime.agent_root,
    agent_id,
    workspace_path,
  });
}

/** 把内部摘要投影为 Mainview 不依赖路径的数据。 */
function to_mainview_item(
  skill: SkillSummary,
  origin?: SkillMainviewOrigin,
): SkillMainviewItem {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    is_link: skill.is_link,
    ...(skill.link_target ? { link_target: skill.link_target } : {}),
    ...(origin ? { origin } : {}),
    allowed_tools: [...skill.allowed_tools],
  };
}

/** 执行跨平台 skills CLI，并收敛超时和进程错误。 */
async function run_skills_cli(
  args: string[],
  cwd: string,
  timeout: number,
): Promise<{ success: true; output: string } | { success: false; error: string }> {
  try {
    const result = await execa(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["-y", "skills", ...args],
      { cwd, timeout, reject: false, all: true },
    );
    const output = strip_ansi(result.all || "");
    return result.exitCode === 0
      ? { success: true, output }
      : { success: false, error: output || `skills CLI failed (${result.exitCode})` };
  } catch (reason) {
    return { success: false, error: to_error_message(reason) };
  }
}

/** 从 skills CLI 的可见输出中提取 `owner/repo@skill` 安装 spec。 */
function parse_search_hits(output: string): SkillMainviewSearchHit[] {
  const hits = new Map<string, SkillMainviewSearchHit>();
  for (const line of output.split("\n")) {
    const match = /([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)@([^\s]+)/u.exec(line);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    const spec = `${match[1]}/${match[2]}@${match[3]}`;
    const url = /https?:\/\/\S+/u.exec(line)?.[0];
    if (!hits.has(spec)) hits.set(spec, { spec, skill: match[3], ...(url ? { url } : {}) });
  }
  return [...hits.values()];
}

/** 删除终端 ANSI 控制序列。 */
function strip_ansi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*[A-Za-z]/gu, "");
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

/** 解析只带 agent_id 的输入。 */
function read_agent_query(input: PowerJsonValue | undefined): AgentQuery {
  return { agent_id: read_required_string(input, "agent_id") };
}

/** 解析 read 输入。 */
function read_read_input(input: PowerJsonValue | undefined): SkillMainviewReadInput {
  const value = read_record(input).scope;
  if (value !== undefined && value !== "agent" && value !== "project" && value !== "home") {
    throw new Error("scope must be agent, project, or home");
  }
  return {
    agent_id: read_required_string(input, "agent_id"),
    skill_id: read_required_string(input, "skill_id"),
    scope: value ?? "agent",
    ...read_optional_workspace_id(input),
  };
}

/** 解析安装输入。 */
function read_install_input(input: PowerJsonValue | undefined): SkillMainviewInstallInput {
  return {
    agent_id: read_required_string(input, "agent_id"),
    spec: read_required_string(input, "spec"),
  };
}

/** 解析关联输入。 */
function read_link_input(input: PowerJsonValue | undefined): SkillMainviewLinkInput {
  return {
    agent_id: read_required_string(input, "agent_id"),
    skill_id: read_required_string(input, "skill_id"),
    scope: read_link_scope(read_record(input).scope),
    ...read_optional_workspace_id(input),
  };
}

/** 解析删除输入。 */
function read_remove_input(input: PowerJsonValue | undefined): SkillMainviewRemoveInput {
  return {
    agent_id: read_required_string(input, "agent_id"),
    skill_id: read_required_string(input, "skill_id"),
  };
}

/** 读取可选的 Workspace ID。 */
function read_optional_workspace_id(
  input: PowerJsonValue | undefined,
): { workspace_id?: string } {
  const value = read_record(input).workspace_id;
  if (typeof value !== "string") return {};
  const workspace_id = value.trim();
  return workspace_id ? { workspace_id } : {};
}

/** 读取并校验可关联的来源范围。 */
function read_link_scope(value: PowerJsonValue | undefined): SkillMainviewScope {
  if (value === "project" || value === "home") return value;
  throw new Error("scope must be project or home");
}

/** 把未知失败转换为稳定错误文本。 */
function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 把结构化协议显式收敛到 Power JSON 边界。 */
function as_json(value: unknown): PowerJsonValue {
  return value as PowerJsonValue;
}
