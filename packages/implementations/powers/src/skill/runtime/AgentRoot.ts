/**
 * Skill 根目录与 Agent 私有目录解析。
 *
 * 关键点（中文）
 * - Agent 的技能目录是 `~/.downcity/agents/<agent-id>/skills`，与 Agent 其它私有数据同级。
 * - Power 生命周期存储根是 `~/.downcity/powers/skill`，因此这里向上两级得到 Downcity 根，
 *   再拼出 Agent 目录。这条耦合是刻意的：路径事实只在这里推导一次，其它模块不得自行拼接。
 * - 一次模型调用的 `context.storage` 又是另一个目录（`~/.downcity/agents/<id>/powers/skill`），
 *   因此不能用它反推技能目录。
 * - 该模块是 skill 路径规则的唯一入口。
 */

import os from "node:os";
import path from "node:path";
import type { SkillRootContext } from "./Paths.js";

/**
 * Agent 技能目录相对 Downcity 根的路径模板。
 *
 * 说明（中文）
 * - `<agent-id>` 由调用方替换；该目录由用户或 Agent 自己安装、关联技能。
 */
export const AGENT_SKILLS_RELATIVE_DIRECTORY = path.join("agents", "<agent-id>", "skills");

/**
 * 由 Power 生命周期存储根解析单个 Agent 的技能目录。
 *
 * 关键点（中文）
 * - 生命周期根形如 `<downcity_root>/powers/skill`，向上两级即 `<downcity_root>`。
 * - 传入空 agent_id 时返回 `agents` 根，用于授权整个 Agent 目录树。
 */
export function resolve_agent_skill_dir(
  lifecycle_storage_path: string,
  agent_id_input: string,
): string {
  const root = String(lifecycle_storage_path || "").trim();
  if (!root) throw new Error("SkillPower lifecycle storage path is required");
  const downcity_root = resolve_downcity_root(path.resolve(root));
  const agent_id = String(agent_id_input || "").trim();
  if (!agent_id) return path.join(downcity_root, "agents");
  assert_safe_agent_id(agent_id);
  return path.join(downcity_root, "agents", agent_id, "skills");
}

/**
 * 由生命周期存储根反推 Downcity 用户级数据根。
 *
 * 说明（中文）
 * - 结构固定为 `<downcity_root>/powers/<power-id>`，因此向上两级即可。
 */
export function resolve_downcity_root(lifecycle_storage_path: string): string {
  const root = path.resolve(String(lifecycle_storage_path || "").trim());
  const power_dir = path.dirname(root);
  const downcity_root = path.dirname(power_dir);
  if (!downcity_root || downcity_root === path.sep) {
    throw new Error(`Cannot resolve Downcity root from lifecycle storage path: ${root}`);
  }
  return downcity_root;
}

/** 拒绝会逃出 Agent 目录的 agent_id。 */
export function assert_safe_agent_id(agent_id: string): void {
  const value = String(agent_id || "").trim();
  if (!value) throw new Error("agent_id is required for agent skills");
  if (value.includes("/") || value.includes("\\") || path.isAbsolute(value) || value === "..") {
    throw new Error(`Invalid agent_id: ${value}`);
  }
}

/**
 * 构造一次扫描所需的完整路径上下文。
 */
export function create_skill_root_context(input: {
  /**
   * 当前 Agent 的技能目录绝对路径。
   */
  agent_skill_dir: string;
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
    agent_skill_dir: input.agent_skill_dir,
    agent_id: String(input.agent_id || "").trim(),
    workspace_path: path.resolve(input.workspace_path),
    home_path: String(input.home_path || "").trim() || os.homedir(),
  };
}
