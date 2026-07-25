/**
 * CLI Agent 项目初始化模块。
 *
 * 职责说明（中文）
 * - CLI `downcity agent create` 与 Console 共用同一套初始化逻辑，避免模板与目录结构分叉。
 * - 负责创建项目运行目录、项目 `.env` 与 Skills 目录。
 * - CLI 侧运行配置应写入宿主配置存储，不再由 SDK 初始化器写项目配置文件。
 *
 * 边界说明（中文）
 * - 这里只处理“初始化一个新项目”所需的静态文件与目录，不处理 downcity 托管进程启停。
 * - 这里只校验项目创建阶段依赖的最小平台条件，不承担后续运行时配置合并职责。
 */

import fs from "fs-extra";
import path from "node:path";
import type { EnvFileEntry } from "@/city/types/config/EnvFile.js";
import { append_missing_env_entries } from "@/city/agent/setup/EnvFile.js";
import { ensure_gitignore_entry } from "@/city/agent/setup/Gitignore.js";
import type {
  AgentProjectChannel,
  AgentProjectInitializationInput,
  AgentProjectInitializationResult,
} from "@/city/types/config/AgentProject.js";
import type { ExecutionBindingConfig } from "@/city/types/config/ExecutionBinding.js";
import { assert_project_execution_target } from "@/city/agent/runtime/ExecutionBinding.js";

/**
 * 规范化默认 Agent ID。
 *
 * 关键点（中文）
 * - 把目录名清洗为稳定、可重复的 snake_case 标识，避免展示名语义混入 SDK。
 * - 这里只做最小格式规整，不负责跨项目唯一性分配。
 */
export function normalize_default_agent_id(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .trim();
}

/**
 * 规范化用户选择的渠道列表。
 *
 * 关键点（中文）
 * - 只保留当前 agent 初始化流程支持的渠道。
 * - 会自动去重并统一为小写，避免调用方在外部重复做清洗。
 */
function normalize_channels(input: AgentProjectChannel[] | undefined): AgentProjectChannel[] {
  const allowed = new Set<AgentProjectChannel>(["telegram", "feishu", "qq"]);
  const seen = new Set<AgentProjectChannel>();
  for (const item of Array.isArray(input) ? input : []) {
    const value = String(item || "").trim().toLowerCase() as AgentProjectChannel;
    if (!allowed.has(value)) continue;
    seen.add(value);
  }
  return [...seen];
}

/**
 * 初始化 agent 项目骨架。
 *
 * 关键点（中文）
 * - 会创建 `.downcity` 运行目录、项目 `.env` 与 `.agents/skills`。
 * - 对已存在文件采取“能跳过就跳过、明确冲突则报错”的策略，降低误覆盖风险。
 * - 返回结果只描述本次初始化写入摘要，方便 CLI 与控制台直接展示。
 */
export async function initialize_agent_project(
  input: AgentProjectInitializationInput,
): Promise<AgentProjectInitializationResult> {
  const project_root = path.resolve(String(input.project_root || "").trim() || ".");
  const project_base_name = path.basename(project_root);
  const fallback_agent_id = normalize_default_agent_id(project_base_name) || project_base_name;
  const agent_id = String(input.id || "").trim() || fallback_agent_id;
  const execution = input.execution as ExecutionBindingConfig;

  const channels = normalize_channels(input.channels);
  const dot_env_path = path.join(project_root, ".env");
  const downcity_dir_path = path.join(project_root, ".downcity");
  const skills_dir_path = path.join(project_root, ".agents", "skills");
  const created_files: string[] = [];
  const skipped_files: string[] = [];

  assert_project_execution_target({
    id: agent_id,
    version: "1.0.0",
    execution,
  });

  await fs.ensureDir(project_root);

  const dot_env_exists = await fs.pathExists(dot_env_path);
  await append_missing_env_entries(
    dot_env_path,
    "Downcity Create",
    [] satisfies EnvFileEntry[],
  );
  (dot_env_exists ? skipped_files : created_files).push(".env");

  const downcity_gitignore_status = await ensure_gitignore_entry(project_root, ".downcity");
  const dotenv_gitignore_status = await ensure_gitignore_entry(project_root, ".env");
  if (
    downcity_gitignore_status !== "unchanged" ||
    dotenv_gitignore_status !== "unchanged"
  ) {
    created_files.push(".gitignore");
  } else {
    skipped_files.push(".gitignore");
  }

  const downcity_dir_exists = await fs.pathExists(downcity_dir_path);
  const skills_dir_exists = await fs.pathExists(skills_dir_path);
  const directories = [
    downcity_dir_path,
    path.join(downcity_dir_path, "task"),
    path.join(downcity_dir_path, "logs"),
    path.join(downcity_dir_path, ".cache"),
    path.join(downcity_dir_path, "profile"),
    path.join(downcity_dir_path, "data"),
    path.join(downcity_dir_path, "agents"),
    path.join(downcity_dir_path, "public"),
    path.join(downcity_dir_path, "resources"),
    skills_dir_path,
    path.join(downcity_dir_path, ".debug"),
  ];
  for (const directory of directories) {
    await fs.ensureDir(directory);
  }
  (downcity_dir_exists ? skipped_files : created_files).push(".downcity/");
  (skills_dir_exists ? skipped_files : created_files).push(".agents/skills/");

  try {
    const profile_directory = path.join(downcity_dir_path, "profile");
    await fs.ensureDir(profile_directory);
    await fs.ensureFile(path.join(profile_directory, "Primary.md"));
    await fs.ensureFile(path.join(profile_directory, "other.md"));
  } catch {
    // ignore optional profile memory bootstrap errors
  }

  return {
    project_root,
    id: agent_id,
    ...(execution?.type === "api" && String(execution.model_id || "").trim()
      ? { model_id: String(execution.model_id || "").trim() }
      : {}),
    channels,
    created_files,
    skipped_files,
  };
}
