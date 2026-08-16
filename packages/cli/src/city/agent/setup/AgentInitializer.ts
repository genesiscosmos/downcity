/**
 * CLI Agent 项目初始化模块。
 *
 * 职责说明（中文）
 * - CLI `downcity agent create` 与 Console 共用同一套初始化逻辑，避免模板与目录结构分叉。
 * - 负责创建 Workspace 运行目录、项目 `.env` 与 Skills 目录。
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
 * 初始化 agent 项目骨架。
 *
 * 关键点（中文）
 * - 只创建项目 `.env` 与 `.agents/skills`；运行状态由用户级 AgentWorkspace 目录持有。
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

  const dot_env_path = path.join(project_root, ".env");
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

  const dotenv_gitignore_status = await ensure_gitignore_entry(project_root, ".env");
  if (dotenv_gitignore_status !== "unchanged") {
    created_files.push(".gitignore");
  } else {
    skipped_files.push(".gitignore");
  }

  const skills_dir_exists = await fs.pathExists(skills_dir_path);
  await fs.ensureDir(skills_dir_path);
  (skills_dir_exists ? skipped_files : created_files).push(".agents/skills/");

  return {
    project_root,
    id: agent_id,
    ...(execution?.type === "api" && String(execution.model_id || "").trim()
      ? { model_id: String(execution.model_id || "").trim() }
      : {}),
    created_files,
    skipped_files,
  };
}
