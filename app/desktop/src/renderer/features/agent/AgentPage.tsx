/** Agent 管理页：MainView 组合内容与右侧「Agent」域。 */
import { useMemo } from "react";

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, NavigationTarget } from "@/types/DesktopView";
import type { DesktopAgentSummary, DesktopSessionSummary } from "@common/types/DesktopApi";

import { WelcomeView } from "@/app/WelcomeView";

import { MainView } from "@/layouts/BayBar";

import { AgentView } from "@/features/agent/AgentView";
import { use_translation } from "@/locales/i18n";

/** Agent 配置路由只订阅当前 Agent 与其主 Session 索引。 */
export function AgentRouteMainView({ selection, controller, sidebar_collapsed }: { /** Agent 配置导航目标。 */ selection: Extract<NavigationTarget, { kind: "agent" }>; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean }) {
  const agent = use_desktop_selector(controller.stores.catalog, (state) => state.agents.find((item) => item.agent_id === selection.agent_id));
  const main_context = use_desktop_selector(controller.stores.settings, (state) => state.settings.agent_main_sessions[selection.agent_id]);
  const main_session = use_desktop_selector(controller.stores.session, (state) => main_context
    ? (state.sessions_by_workspace[main_context.workspace_id] ?? []).find((item) => item.agent_id === selection.agent_id && item.session.session_id === main_context.session_id)
    : undefined);
  if (!agent) return <WelcomeView />;
  return <AgentMainView key={`agent:${agent.agent_id}`} agent={agent} controller={controller} sidebar_collapsed={sidebar_collapsed} main_session={main_context && main_session ? { workspace_id: main_context.workspace_id, session: main_session.session } : undefined} />;
}

/** Agent MainView：定义状态在此持有，配置分区注册为右侧「Agent」tab。 */
export function AgentMainView({ agent, controller, sidebar_collapsed, main_session }: { /** 当前 Agent。 */ agent: DesktopAgentSummary; /** Desktop 稳定控制器。 */ controller: DesktopController; /** 全局 Sidebar 是否折叠。 */ sidebar_collapsed: boolean; /** Agent 主对话。 */ main_session?: { workspace_id: string; session: DesktopSessionSummary } }) {
  // 不在这里组装标签页：标签页在正文的入口被点击时构造并打开（见 agent_config_tab）。
  return <MainView>
    <AgentView agent={agent} main_session={main_session} controller={controller} open_main_session={() => controller.actions.open_agent_chat(agent.agent_id)} />
  </MainView>;
}

/** resources 命名空间的翻译函数。 */
function useTranslation_resources() {
  return use_translation("resources");
}
