/**
 * Skill 根目录与 Agent 私有目录解析。
 *
 * 关键点（中文）
 * - Power 生命周期存储根是 `~/.downcity/powers/skill`；Agent 私有 skill 目录是它下面的 `agents/<agent-id>`。
 * - 一次模型调用的 `context.storage` 是另一个目录（`~/.downcity/agents/<id>/powers/skill`），
 *   因此这里显式从生命周期根派生，模型侧与宿主侧共用同一份路径事实。
 * - 该模块是 skill 路径规则的唯一入口，其它模块不得自行拼接目录。
 */

import os from "node:os";
import path from "node:path";
import type { SkillRootContext } from "./Paths.js";
import { AGENT_SKILLS_DIRECTORY } from "./Paths.js";

/**
 * 由 Power 生命周期存储根解析 Agent 私有 skill 根。
 *
 * 说明（中文）
 * - 返回值即 `<agent_root>/<agent-id>` 的父目录。
 */
export function resolve_agent_skills_root(lifecycle_storage_path: string): string {
  const root = String(lifecycle_storage_path || "").trim();
  if (!root) throw new Error("SkillPower lifecycle storage path is required");
  return path.join(path.resolve(root), AGENT_SKILLS_DIRECTORY);
}

/**
 * 构造一次扫描所需的完整路径上下文。
 */
export function create_skill_root_context(input: {
  /**
   * Agent 私有 skill 根目录绝对路径。
   */
  agent_root: string;
  /**
   * 当前 Agent 稳定标识。
   */
  agent_id: string;
  /**
   * 当前 Workspace 根目录绝对路径。
   */
  workspace_path: string;
  /**
   * 用户目录绝对路径；省略时读取当前进程用户目录。
   */
  home_path?: string;
}): SkillRootContext {
  return {
    agent_root: input.agent_root,
    agent_id: String(input.agent_id || "").trim(),
    workspace_path: path.resolve(input.workspace_path),
    home_path: String(input.home_path || "").trim() || os.homedir(),
  };
}
