/**
 * Agent 页：点侧栏的 Agent 直接进入它的会话。
 *
 * ## 为什么不再有配置页
 *
 * Agent 自己就是一条 Session（`origin.type = "agent"`，`session_id` 等于 agent_id），
 * 所以「这个 Agent」与「和它说话的地方」是同一个对象。把它做成两个页面会要求用户
 * 先在一处选 Agent、再在另一处开始说话，而这个选择本来就不存在。
 *
 * 配置因此不再占主视图：identity / model / SOUL 由侧栏行菜单与聊天页头部两处入口
 * 打开右侧 BayBar 标签页（见 `agent_config_tab`），随开随关，不打断对话。
 *
 * ## 打开时机
 *
 * 会话由主进程按需创建（`chat.open_agent_session`），因为渲染层不确定它是否已存在。
 * 这里只负责触发一次并等待，等不到就显示空态。
 */

import { useEffect } from "react";

import { use_desktop_selector } from "@/app/use_desktop";

import type { DesktopController, NavigationTarget } from "@/types/DesktopView";

import { WelcomeView } from "@/app/WelcomeView";
import { MainView } from "@/layouts/MainViewLayout";
import { use_translation } from "@/locales/i18n";

/**
 * Agent 路由：进入该 Agent 自己的会话。
 *
 * 它不渲染聊天正文——正文由既有的 Session 路由负责（Agent 会话就是一条普通 Session）。
 * 这里只把导航目标换成对应的会话目标，目标就位后由路由渲染。
 */
export function AgentRouteMainView({ selection, controller, sidebar_collapsed }: {
  /** Agent 导航目标。 */
  selection: Extract<NavigationTarget, { kind: "agent" }>;
  /** Desktop 稳定控制器。 */
  controller: DesktopController;
  /** 全局 Sidebar 是否折叠。 */
  sidebar_collapsed: boolean;
}) {
  const translate = use_translation();
  const agent = use_desktop_selector(controller.stores.catalog, (state) =>
    state.agents.find((item) => item.agent_id === selection.agent_id));

  // 打开动作只触发一次：依赖只取 agent_id，避免 Agent 摘要更新时重复请求。
  const agent_id = selection.agent_id;
  useEffect(() => {
    // 侧栏切回主体列表：Agent 会话属于主体，不属于某个 Workspace 的会话列表。
    controller.actions.set_sidebar_mode("chat");
    void controller.actions.open_agent_chat(agent_id);
  }, [agent_id, controller.actions]);

  if (!agent) return <WelcomeView />;
  return <MainView>
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      {translate("state.loading")}
    </div>
  </MainView>;
}
