/**
 * Agent Workspace 项目初始化模块。
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
import {
  getCacheDirPath,
  getLogsDirPath,
  getDowncityDataDirPath,
  getDowncityDebugDirPath,
  getDowncityDirPath,
  getDowncityProfileDirPath,
  getDowncityProfileOtherPath,
  getDowncityProfilePrimaryPath,
  getDowncityPublicDirPath,
  getDowncityResourcesDirPath,
  getDowncityTasksDirPath,
} from "@/workspace/WorkspacePaths.js";
import { get_sdk_agents_root_dir_path } from "@/workspace/store/LocalStorePaths.js";
import type { EnvFileEntry } from "@/types/common/EnvFile.js";
import { appendMissingEnvEntries } from "@/workspace/setup/EnvFile.js";
import { ensureGitignoreEntry } from "@/workspace/setup/Gitignore.js";
import { ensureDir } from "@/utils/storage/index.js";
import type {
  AgentProjectChannel,
  AgentProjectInitializationInput,
  AgentProjectInitializationResult,
} from "@/types/config/AgentProject.js";
import type { ExecutionBindingConfig } from "@/types/config/ExecutionBinding.js";
import { assertProjectExecutionTarget } from "@/agent/ExecutionBinding.js";

/**
 * 规范化默认 Agent ID。
 *
 * 关键点（中文）
 * - 把目录名清洗为稳定、可重复的 snake_case 标识，避免展示名语义混入 SDK。
 * - 这里只做最小格式规整，不负责跨项目唯一性分配。
 */
export function normalizeDefaultAgentId(input: string): string {
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
function normalizeChannels(input: AgentProjectChannel[] | undefined): AgentProjectChannel[] {
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
export async function initializeAgentProject(
  input: AgentProjectInitializationInput,
): Promise<AgentProjectInitializationResult> {
  const projectRoot = path.resolve(String(input.projectRoot || "").trim() || ".");
  const projectBaseName = path.basename(projectRoot);
  const fallback_agent_id = normalizeDefaultAgentId(projectBaseName) || projectBaseName;
  const agent_id = String(input.id || "").trim() || fallback_agent_id;
  const execution = input.execution as ExecutionBindingConfig;

  const channels = normalizeChannels(input.channels);
  const dotEnvPath = path.join(projectRoot, ".env");
  const downcity_dir_path = getDowncityDirPath(projectRoot);
  const skills_dir_path = path.join(projectRoot, ".agents", "skills");
  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  assertProjectExecutionTarget({
    id: agent_id,
    version: "1.0.0",
    execution,
  });

  await ensureDir(projectRoot);

  const dot_env_exists = await fs.pathExists(dotEnvPath);
  await appendMissingEnvEntries(
    dotEnvPath,
    "Downcity Create",
    [] satisfies EnvFileEntry[],
  );
  (dot_env_exists ? skippedFiles : createdFiles).push(".env");

  const downcity_gitignore_status = await ensureGitignoreEntry(projectRoot, ".downcity");
  const dotenv_gitignore_status = await ensureGitignoreEntry(projectRoot, ".env");
  if (
    downcity_gitignore_status !== "unchanged" ||
    dotenv_gitignore_status !== "unchanged"
  ) {
    createdFiles.push(".gitignore");
  } else {
    skippedFiles.push(".gitignore");
  }

  const downcity_dir_exists = await fs.pathExists(downcity_dir_path);
  const skills_dir_exists = await fs.pathExists(skills_dir_path);
  const dirs = [
    downcity_dir_path,
    getDowncityTasksDirPath(projectRoot),
    getLogsDirPath(projectRoot),
    getCacheDirPath(projectRoot),
    getDowncityProfileDirPath(projectRoot),
    getDowncityDataDirPath(projectRoot),
    get_sdk_agents_root_dir_path(projectRoot),
    getDowncityPublicDirPath(projectRoot),
    getDowncityResourcesDirPath(projectRoot),
    skills_dir_path,
    getDowncityDebugDirPath(projectRoot),
  ];
  for (const dir of dirs) {
    await ensureDir(dir);
  }
  (downcity_dir_exists ? skippedFiles : createdFiles).push(".downcity/");
  (skills_dir_exists ? skippedFiles : createdFiles).push(".agents/skills/");

  try {
    await ensureDir(getDowncityProfileDirPath(projectRoot));
    await fs.ensureFile(getDowncityProfilePrimaryPath(projectRoot));
    await fs.ensureFile(getDowncityProfileOtherPath(projectRoot));
  } catch {
    // ignore optional profile memory bootstrap errors
  }

  return {
    projectRoot,
    id: agent_id,
    ...(execution?.type === "api" && String(execution.modelId || "").trim()
      ? { modelId: String(execution.modelId || "").trim() }
      : {}),
    channels,
    createdFiles,
    skippedFiles,
  };
}
