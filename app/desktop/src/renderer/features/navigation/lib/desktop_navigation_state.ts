/** Desktop 页面导航状态的序列化、校验与降级恢复。 */

import type { DesktopNavigationCatalog, RestorableNavigationTarget } from "@/types/DesktopNavigation";
import type { NavigationTarget, SidebarMode } from "@/types/DesktopView";

/** 当前页面恢复状态在 localStorage 中的唯一键。 */
export const desktop_navigation_storage_key = "downcity.navigation_target";

/** 判断目标是否属于刷新后仍有明确语义的稳定页面。 */
export function is_restorable_navigation_target(target: NavigationTarget): target is RestorableNavigationTarget {
  return target.kind !== "create_agent" && target.kind !== "create_group" && target.kind !== "draft" && target.kind !== "group_draft" && target.kind !== "settings";
}

/** 从稳定导航目标推导一级侧栏，避免持久化第二份可能漂移的状态。 */
export function get_sidebar_mode_for_navigation(target: RestorableNavigationTarget): SidebarMode {
  if (target.kind === "workspace" || target.kind === "workspace_file") return "workspace";
  if (target.kind === "power" || target.kind === "powers") return "powers";
  if (target.kind === "power_workspace") return `power:${target.power_id}`;
  return "chat";
}

/** 把 localStorage 中的不可信 JSON 解析为结构合法的稳定导航目标。 */
export function parse_navigation_target(serialized: string | null): RestorableNavigationTarget | undefined {
  if (!serialized) return undefined;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!is_record(value) || typeof value.kind !== "string") return undefined;
    if (value.kind === "powers") return { kind: "powers" };
    if (value.kind === "workspace" && has_string(value, "workspace_id")) return { kind: "workspace", workspace_id: value.workspace_id };
    if (value.kind === "workspace_file" && has_string(value, "workspace_id") && has_string(value, "relative_path")) {
      const line = read_positive_integer(value.line);
      return { kind: "workspace_file", workspace_id: value.workspace_id, relative_path: value.relative_path, ...(line ? { line } : {}) };
    }
    if (value.kind === "agent" && has_string(value, "agent_id")) return { kind: "agent", agent_id: value.agent_id };
    if (value.kind === "session" && has_string(value, "workspace_id") && has_string(value, "agent_id") && has_string(value, "session_id")) return { kind: "session", workspace_id: value.workspace_id, agent_id: value.agent_id, session_id: value.session_id };
    if (value.kind === "group" && has_string(value, "group_id")) return { kind: "group", group_id: value.group_id };
    if (value.kind === "group_session" && has_string(value, "group_id") && has_string(value, "workspace_id") && has_string(value, "session_id")) return { kind: "group_session", group_id: value.group_id, workspace_id: value.workspace_id, session_id: value.session_id };
    if (value.kind === "power" && has_string(value, "power_id")) return { kind: "power", power_id: value.power_id };
    if (value.kind === "power_workspace" && has_string(value, "power_id")) return { kind: "power_workspace", power_id: value.power_id };
  } catch {
    return undefined;
  }
  return undefined;
}

/** 根据最新目录校验恢复目标，并在资源已删除时退回最近的有效业务页面。 */
export function resolve_navigation_target(target: RestorableNavigationTarget | undefined, catalog: DesktopNavigationCatalog, default_workspace_id = ""): RestorableNavigationTarget | undefined {
  const fallback_workspace = catalog.workspaces.find((workspace) => workspace.workspace_id === default_workspace_id) ?? catalog.workspaces[0];
  if (!target) return fallback_workspace ? { kind: "workspace", workspace_id: fallback_workspace.workspace_id } : undefined;
  if (target.kind === "powers") return target;
  if (target.kind === "workspace" || target.kind === "workspace_file") {
    return catalog.workspaces.some((workspace) => workspace.workspace_id === target.workspace_id)
      ? target
      : fallback_workspace ? { kind: "workspace", workspace_id: fallback_workspace.workspace_id } : undefined;
  }
  if (target.kind === "agent") return catalog.agents.some((agent) => agent.agent_id === target.agent_id)
    ? target
    : fallback_workspace ? { kind: "workspace", workspace_id: fallback_workspace.workspace_id } : undefined;
  if (target.kind === "session") {
    const agent_exists = catalog.agents.some((agent) => agent.agent_id === target.agent_id);
    const session_exists = catalog.sessions_by_workspace[target.workspace_id]?.some((entry) => entry.agent_id === target.agent_id && entry.session.session_id === target.session_id);
    if (agent_exists && session_exists) return target;
    if (agent_exists) return { kind: "agent", agent_id: target.agent_id };
    return fallback_workspace ? { kind: "workspace", workspace_id: fallback_workspace.workspace_id } : undefined;
  }
  if (target.kind === "group" || target.kind === "group_session") {
    const group = catalog.groups.find((item) => item.group_id === target.group_id);
    if (!group) return fallback_workspace ? { kind: "workspace", workspace_id: fallback_workspace.workspace_id } : undefined;
    if (target.kind === "group_session" && group.sessions.some((session) => session.session_id === target.session_id && session.workspace_id === target.workspace_id)) return target;
    return { kind: "group", group_id: group.group_id };
  }
  const power = catalog.powers.find((item) => item.power_id === target.power_id);
  if (!power) return { kind: "powers" };
  if (target.kind === "power_workspace" && (!power.has_sidebar || !power.has_mainview)) return { kind: "powers" };
  return target;
}

/** 判断未知值是否为普通键值对象。 */
function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判断对象字段是否为非空字符串。 */
function has_string(value: Record<string, unknown>, key: string): value is Record<string, unknown> & Record<typeof key, string> {
  return typeof value[key] === "string" && value[key].length > 0;
}

/** 读取可选的 1 基行号；非法值直接忽略，使被写入脏数据的导航目标仍可恢复。 */
function read_positive_integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
