/**
 * Skill 目录解析。
 *
 * 关键点（中文）
 * - Agent 的技能目录是 `<data_root_path>/agents/<agent-id>/skills`，与 Agent 其它私有数据同级。
 * - `data_root_path` 是容器事实（`PowerContext.data_root_path` /
 *   `PowerLifecycleContext.data_root_path`），由 City 直接提供；本模块不从 Power
 *   自身的存储路径向上推断，那会随目录结构调整而静默算错。
 * - 该模块是 skill 路径规则的唯一入口，其它模块不得自行拼接目录。
 */

import os from "node:os";
import path from "node:path";
import type { SkillRootContext } from "./Paths.js";

/**
 * Agent 技能目录相对数据根的路径模板。
 *
 * 说明（中文）
 * - `<agent-id>` 由调用方替换；该目录由用户或 Agent 自己安装、关联技能。
 */
export const AGENT_SKILLS_RELATIVE_DIRECTORY = path.join("agents", "<agent-id>", "skills");

/** 拒绝会逃出 Agent 目录的 agent_id。 */
export function assert_safe_agent_id(agent_id: string): void {
  const value = String(agent_id || "").trim();
  if (!value) throw new Error("agent_id is required for agent skills");
  if (value.includes("/") || value.includes("\\") || path.isAbsolute(value) || value === "..") {
    throw new Error(`Invalid agent_id: ${value}`);
  }
}

/**
 * 解析 Agent 技能目录根，即 `<data_root_path>/agents`。
 *
 * 说明（中文）：传入空 agent_id 时返回 `agents` 根，用于授权整个 Agent 目录树。
 */
export function resolve_agents_root(data_root_path: string): string {
  const root = String(data_root_path || "").trim();
  if (!root) throw new Error("SkillPower data root path is required");
  return path.join(path.resolve(root), "agents");
}

/** 解析单个 Agent 的技能目录。 */
export function resolve_agent_skill_dir(
  data_root_path: string,
  agent_id: string,
): string {
  assert_safe_agent_id(agent_id);
  return path.join(resolve_agents_root(data_root_path), agent_id, "skills");
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
