/**
 * Desktop 命令面板子页面的行数据。
 *
 * 只负责把领域快照投影成可渲染的行；不持有面板状态，也不做键盘处理。
 * 这样面板本体可以用同一套行渲染处理「根命令」与「子页面行」，避免两套列表样式漂移。
 */

import { useMemo } from "react";
import { TbChevronRight, TbMoodNeutral, TbSphere2, TbScript } from "react-icons/tb";
import { use_desktop_selector } from "@/app/use_desktop";
import { order_rail_powers } from "@/features/navigation/lib/sidebar_shortcut";
import { PowerIcon } from "@/features/power/lib/PowerIcon";
import { get_session_key } from "@/features/chat/lib/chat_cache_key";
import { format_date } from "@/locales/format";
import { use_desktop_language } from "@/locales/i18n";
import type { DesktopController } from "@/types/DesktopView";
import type { CommandPage, CommandPageItem } from "./types.ts";

/** 会话子页面的行数上限；超出时截断而不是虚拟化。 */
const session_page_limit = 200;

/** 子页面数据状态；`loading` 只在会话索引尚未水合时出现。 */
export type CommandPageStatus = "ready" | "loading" | "empty";

/** 一个子页面的投影结果。 */
export interface CommandPageProjection {
  /** 当前应展示的行。 */
  items: readonly CommandPageItem[];
  /** 空状态来源；面板据此选择空态或加载态文案。 */
  status: CommandPageStatus;
  /** 会话子页面的作用域提示；其它页面为空。 */
  scope_label?: string;
}

/** 按当前页面、查询与领域快照投影出子页面行。 */
export function use_command_page_items(
  page: CommandPage,
  query: string,
  controller: DesktopController,
): CommandPageProjection {
  const language = use_desktop_language();
  const workspaces = use_desktop_selector(controller.stores.catalog, (state) => state.workspaces);
  const agents = use_desktop_selector(controller.stores.catalog, (state) => state.agents);
  const powers = use_desktop_selector(controller.stores.catalog, (state) => state.powers);
  const sessions_by_workspace = use_desktop_selector(controller.stores.session, (state) => state.sessions_by_workspace);
  const selection = use_desktop_selector(controller.stores.navigation, (state) => state.selection);
  const active_workspace_id = use_desktop_selector(controller.stores.navigation, (state) => state.active_workspace_id);
  const actions = controller.actions;

  return useMemo<CommandPageProjection>(() => {
    const tokens = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    const matches = (...values: readonly (string | undefined)[]) => {
      if (tokens.length === 0) return true;
      const haystack = values.filter(Boolean).join(" ").toLocaleLowerCase();
      return tokens.every((token) => haystack.includes(token));
    };

    if (page === "workspaces") {
      const items = workspaces
        .filter((workspace) => matches(workspace.name, workspace.workspace_path))
        .map<CommandPageItem>((workspace) => ({
          id: `workspace:${workspace.workspace_id}`,
          title: workspace.name || workspace.workspace_path,
          subtitle: workspace.workspace_path,
          icon: <TbSphere2 className="size-4" />,
          is_current: workspace.workspace_id === active_workspace_id,
          run: () => actions.select_workspace(workspace.workspace_id),
        }));
      return { items, status: workspaces.length === 0 ? "empty" : "ready" };
    }

    if (page === "agents") {
      const items = agents
        .filter((agent) => matches(agent.name, agent.description))
        .map<CommandPageItem>((agent) => ({
          id: `agent:${agent.agent_id}`,
          title: agent.name,
          subtitle: agent.description,
          icon: <TbMoodNeutral className="size-4" />,
          is_current: selection?.kind === "agent" && selection.agent_id === agent.agent_id,
          run: () => actions.open_agent_chat(agent.agent_id),
        }));
      return { items, status: agents.length === 0 ? "empty" : "ready" };
    }

    if (page === "sessions") {
      const workspace = workspaces.find((item) => item.workspace_id === active_workspace_id);
      if (!active_workspace_id) return { items: [], status: "empty" };
      // 索引尚未水合时不能把「还没读到」当成「没有会话」，否则第一个打开面板的用户会看到错误结论。
      if (!(active_workspace_id in sessions_by_workspace)) return { items: [], status: "loading" };
      const entries = [...(sessions_by_workspace[active_workspace_id] ?? [])]
        .sort((left, right) => right.session.updated_at - left.session.updated_at)
        .slice(0, session_page_limit);
      const items = entries
        .filter((entry) => matches(entry.session.title, entry.session.preview_text))
        .map<CommandPageItem>((entry) => {
          const agent = agents.find((item) => item.agent_id === entry.agent_id);
          return {
            id: `session:${get_session_key(active_workspace_id, entry.agent_id, entry.session.session_id)}`,
            title: entry.session.title || entry.session.session_id,
            subtitle: [agent?.name, format_date(entry.session.updated_at, language, { dateStyle: "short" })].filter(Boolean).join(" · "),
            icon: <TbScript className="size-4" />,
            is_current: selection?.kind === "session" && selection.session_id === entry.session.session_id,
            run: () => actions.select_session(active_workspace_id, entry.agent_id, entry.session.session_id),
          };
        });
      return {
        items,
        status: items.length === 0 ? "empty" : "ready",
        scope_label: workspace?.name || workspace?.workspace_path || "",
      };
    }

    if (page === "powers") {
      // 复用 Rail 顺序，保证面板里的 Power 顺序与侧栏图标顺序一致。
      const items = order_rail_powers(powers)
        .filter((power) => matches(power.title, power.description))
        .map<CommandPageItem>((power) => ({
          id: `power:${power.power_id}`,
          title: power.title || power.power_id,
          subtitle: power.description,
          icon: <PowerIcon power_id={power.power_id} icon_url={power.icon_url} />,
          is_current: selection?.kind === "power_workspace" && selection.power_id === power.power_id,
          run: () => actions.select_power_workspace(power.power_id),
        }));
      return { items, status: items.length === 0 ? "empty" : "ready" };
    }

    return { items: [], status: "ready" };
  }, [actions, active_workspace_id, agents, language, page, powers, query, selection, sessions_by_workspace, workspaces]);
}

/** 子页面行的尾部装饰：当前项显示对勾，其余显示可进入箭头。 */
export function command_page_item_trailing(is_current: boolean | undefined) {
  return is_current ? undefined : <TbChevronRight className="size-3.5 text-subtle-foreground" />;
}
