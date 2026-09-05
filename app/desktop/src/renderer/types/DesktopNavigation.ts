/** Desktop 可恢复导航状态的校验上下文类型。 */

import type { DesktopAgentSummary, DesktopGroupSummary, DesktopPluginSummary, DesktopWorkspaceSummary } from "@common/types/DesktopApi";
import type { DesktopWorkspaceSession, NavigationTarget } from "./DesktopView";

/** 校验持久化导航目标时使用的 Desktop 目录快照。 */
export interface DesktopNavigationCatalog {
  /** 当前可用的 Agent 列表。 */
  agents: DesktopAgentSummary[];
  /** 当前可用的 Workspace 列表。 */
  workspaces: DesktopWorkspaceSummary[];
  /** 当前可用的 Group 列表及其 Session 摘要。 */
  groups: DesktopGroupSummary[];
  /** 当前可用的 Plugin 列表。 */
  plugins: DesktopPluginSummary[];
  /** 按 Workspace 索引的 Agent Session 摘要。 */
  sessions_by_workspace: Record<string, DesktopWorkspaceSession[]>;
}

/** Renderer 刷新后允许恢复的稳定页面。 */
export type RestorableNavigationTarget = Exclude<NavigationTarget,
  | { kind: "create_agent" }
  | { kind: "create_group" }
  | { kind: "draft" }
  | { kind: "group_draft" }
  | { kind: "settings" }
>;
