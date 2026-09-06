/**
 * Skill Plugin 的宿主管理 actions。
 *
 * 宿主界面通过这些 Plugin 级动作浏览、读取、发现、安装和删除 Skill。它不依赖 Agent
 * 实例或 Config；Workspace 列表由宿主作为只读能力注入。
 */

import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import {
  type PluginJsonValue,
  type PluginHostWorkspace,
  type PluginLifecycleContext,
} from "@downcity/city/plugin";
import { listSkills, lookupSkill } from "@/skill/Action.js";
import type { SkillSummary } from "@/skill/types/SkillCommand.js";
import type {
  SkillMainviewInstallInput,
  SkillMainviewCliResult,
  SkillMainviewItem,
  SkillMainviewMutationResult,
  SkillMainviewReadInput,
  SkillMainviewRemoveInput,
  SkillMainviewScope,
  SkillMainviewSearchHit,
  SkillMainviewSearchResult,
  SkillMainviewSnapshot,
} from "@/skill/types/SkillMainview.js";

/** 注册 Skill Plugin 的宿主管理 actions。 */
export function register_skill_plugin_host_actions(context: PluginLifecycleContext): void {
  context.plugin.action({
      id: "skills.list",
      run: async () => as_json(await create_snapshot(context)),
    });
    context.plugin.action({
      id: "skills.read",
      run: async (input) => as_json(await read_skill(context, read_scope_input(input))),
    });
    context.plugin.action({
      id: "skills.find",
      run: async (input) => as_json(await find_skills(read_required_string(input, "query"))),
    });
    context.plugin.action({
      id: "skills.install",
      run: async (input) => as_json(await install_skill(context, read_install_input(input))),
    });
    context.plugin.action({
      id: "skills.remove",
      run: async (input) => as_json(await remove_skill(context, read_remove_input(input))),
  });
}

/** 创建所有 Workspace 与个人 Skill 的稳定快照。 */
async function create_snapshot(context: PluginLifecycleContext): Promise<SkillMainviewSnapshot> {
  const workspaces = await context.system.list_workspaces();
  return {
    success: true,
    workspaces: workspaces.map((workspace) => ({
      workspace_id: workspace.workspace_id,
      name: workspace.name,
      skills: listSkills(workspace.workspace_path, { use: ["project"] }).skills
        .map((skill) => to_mainview_item(skill, "workspace", workspace.workspace_id)),
    })),
    home_skills: listSkills(process.cwd(), { use: ["home"] }).skills
      .map((skill) => to_mainview_item(skill, "home")),
  };
}

/** 把 Agent 运行时摘要投影为 Mainview 不依赖路径的数据。 */
function to_mainview_item(
  skill: SkillSummary,
  scope: SkillMainviewScope,
  workspace_id?: string,
): SkillMainviewItem {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    scope,
    ...(workspace_id ? { workspace_id } : {}),
    allowed_tools: [...skill.allowedTools],
  };
}

/** 在重新发现后读取一个 Skill，避免信任 Renderer 传入的本地路径。 */
async function read_skill(
  context: PluginLifecycleContext,
  input: SkillMainviewReadInput,
) {
  const workspace = await resolve_workspace(context, input.scope, input.workspace_id);
  return await lookupSkill({
    project_root: workspace?.workspace_path ?? process.cwd(),
    request: { name: input.skill_id },
    options: { use: [input.scope === "home" ? "home" : "project"] },
  });
}

/** 使用官方 skills CLI 搜索公开目录。 */
async function find_skills(query: string): Promise<SkillMainviewSearchResult> {
  const cwd = path.join(os.tmpdir(), "downcity-skills-find");
  await fs.ensureDir(cwd);
  const result = await run_skills_cli(["find", query], cwd, 120_000);
  if (!result.success) {
    return { success: false, query, hits: [], error: result.error };
  }
  return { success: true, query, hits: parse_search_hits(result.output) };
}

/** 使用官方 skills CLI 安装并返回刷新后的快照。 */
async function install_skill(
  context: PluginLifecycleContext,
  input: SkillMainviewInstallInput,
): Promise<SkillMainviewMutationResult> {
  const workspace = await resolve_workspace(context, input.scope, input.workspace_id);
  const cwd = workspace?.workspace_path ?? os.homedir();
  const args = ["add", input.spec, ...(input.scope === "home" ? ["-g"] : []), "-y"];
  const result = await run_skills_cli(args, cwd, 10 * 60_000);
  return {
    ...await create_snapshot(context),
    operation_success: result.success,
    ...(!result.success ? { error: result.error } : {}),
  };
}

/** 删除重新发现得到的精确 Skill 目录。 */
async function remove_skill(
  context: PluginLifecycleContext,
  input: SkillMainviewRemoveInput,
): Promise<SkillMainviewMutationResult> {
  const workspace = await resolve_workspace(context, input.scope, input.workspace_id);
  const project_root = workspace?.workspace_path ?? process.cwd();
  const options = { use: [input.scope === "home" ? "home" as const : "project" as const] };
  const skill = listSkills(project_root, options).skills.find((item) => item.id === input.skill_id);
  if (!skill) {
    return {
      ...await create_snapshot(context),
      operation_success: false,
      error: `Skill not found: ${input.skill_id}`,
    };
  }
  await fs.remove(path.dirname(skill.skillMdPath));
  return { ...await create_snapshot(context), operation_success: true };
}

/** 解析 Workspace 范围，并拒绝不存在或缺少 ID 的输入。 */
async function resolve_workspace(
  context: PluginLifecycleContext,
  scope: SkillMainviewScope,
  workspace_id?: string,
): Promise<PluginHostWorkspace | undefined> {
  if (scope === "home") return undefined;
  const id = String(workspace_id || "").trim();
  if (!id) throw new Error("workspace_id is required for workspace skills");
  const workspace = (await context.system.list_workspaces())
    .find((item) => item.workspace_id === id);
  if (!workspace) throw new Error(`Workspace not found: ${id}`);
  return workspace;
}

/** 执行跨平台 skills CLI，并收敛超时和进程错误。 */
async function run_skills_cli(
  args: string[],
  cwd: string,
  timeout: number,
): Promise<SkillMainviewCliResult> {
  try {
    const result = await execa(process.platform === "win32" ? "npx.cmd" : "npx", ["-y", "skills", ...args], {
      cwd,
      timeout,
      reject: false,
      all: true,
    });
    const output = strip_ansi(result.all || "");
    return result.exitCode === 0
      ? { success: true, output }
      : { success: false, error: output || `skills CLI failed (${result.exitCode})` };
  } catch (reason) {
    return { success: false, error: reason instanceof Error ? reason.message : String(reason) };
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

/** 解析 read/remove 共用的范围与 Skill ID。 */
function read_scope_input(input: PluginJsonValue | undefined): SkillMainviewReadInput {
  const record = read_record(input);
  return {
    scope: read_scope(record.scope),
    skill_id: read_required_string(record, "skill_id"),
    ...(typeof record.workspace_id === "string" ? { workspace_id: record.workspace_id.trim() } : {}),
  };
}

/** 解析安装输入。 */
function read_install_input(input: PluginJsonValue | undefined): SkillMainviewInstallInput {
  const record = read_record(input);
  return {
    scope: read_scope(record.scope),
    spec: read_required_string(record, "spec"),
    ...(typeof record.workspace_id === "string" ? { workspace_id: record.workspace_id.trim() } : {}),
  };
}

/** 解析删除输入。 */
function read_remove_input(input: PluginJsonValue | undefined): SkillMainviewRemoveInput {
  return read_scope_input(input);
}

/** 要求一个值为 Plugin JSON object。 */
function read_record(value: PluginJsonValue | undefined): Record<string, PluginJsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Plugin action input must be an object");
  }
  return value;
}

/** 读取对象中的必填字符串。 */
function read_required_string(
  input: PluginJsonValue | Record<string, PluginJsonValue> | undefined,
  key: string,
): string {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, PluginJsonValue>
    : read_record(input as PluginJsonValue | undefined);
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  return value.trim();
}

/** 读取并校验 Skill 配置范围。 */
function read_scope(value: PluginJsonValue | undefined): SkillMainviewScope {
  if (value === "home" || value === "workspace") return value;
  throw new Error("scope must be home or workspace");
}

/** 把结构化协议显式收敛到 Plugin JSON 边界。 */
function as_json(value: unknown): PluginJsonValue {
  return value as PluginJsonValue;
}
