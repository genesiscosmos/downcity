/** Agent Chat：正文 + 两个把「打开某处」交给正文入口的 Provider。 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import type { DesktopController } from "@/types/DesktopView";
import type { DesktopAgentSummary } from "@common/types/DesktopApi";

import { MainView, use_baybar_open } from "@/layouts/BayBar";

import { agent_config_tab } from "@/features/agent/AgentView";
import { ChatFilePanelProvider } from "@/features/chat/panel/ChatFilePanel";
import { TurnFileDiffReviewProvider } from "@/features/chat/components/messages/TurnFileDiffCard";
import { use_translation } from "@/locales/i18n";

/** 打开当前会话所属 Agent 的配置标签页。 */
type OpenAgentConfig = () => void;

/**
 * 让正文深处的入口（消息里的 Agent 名、空会话的头像）打开 Agent 配置标签页。
 *
 * 这些组件都在消息列表深处，拿不到 controller；把动作放在这里提供，
 * 避免把 controller 一路透传下去，也避免它们各自构造标签页。
 */
const OpenAgentConfigContext = createContext<OpenAgentConfig | null>(null);

/** 读取「打开当前 Agent 配置」；不在 Agent Chat 内时为空。 */
export function use_open_agent_config(): OpenAgentConfig | undefined {
  return useContext(OpenAgentConfigContext) ?? undefined;
}

/** Agent Chat MainView 属性。 */
interface AgentChatMainViewProps {
  /** 当前 Agent。 */
  agent: DesktopAgentSummary;
  /** Desktop 稳定控制器。 */
  controller: DesktopController;
  /** 当前对话所属 Workspace；决定「文件」标签页能预览哪个工作区。 */
  workspace_id: string;
  /** 当前 Workspace 的绝对路径；用于文件操作菜单的链接与系统打开。 */
  workspace_path?: string;
  /** 当前 Chat 的稳定标识，用于按会话隔离打开的文件。 */
  view_key: string;
  /** chat_stream 的会话缓存键；「本轮」标签页靠它订阅本轮改动摘要。 */
  session_key: string;
  /** 当前会话标题（原始值，可能为空）；用作「本轮」标签页的标题。 */
  session_title?: string;
  /** 渲染 Chat 正文。 */
  children: ReactNode;
}

/**
 * Agent Chat 的正文容器。
 *
 * 它不构造标签页：三个标签页分别在各自的入口被点击时创建
 * （`agent_config_tab` / `turn_tab` / `files_tab`），
 * 面板因此不需要提前知道有哪些标签页，切换会话也不会换掉已打开的那些。
 * 这里只提供三样东西：打开 Agent 配置的动作、打开文件的动作、选中某一轮的动作。
 */
export function AgentChatMainView({ agent, controller, workspace_id, workspace_path, view_key, session_key, session_title, children }: AgentChatMainViewProps) {
  const translate_resources = useTranslation_resources();
  const open_baybar = use_baybar_open();
  const open_agent_config = useCallback<OpenAgentConfig>(() => {
    open_baybar(agent_config_tab(agent, controller, translate_resources));
  }, [agent, controller, open_baybar, translate_resources]);
  const agent_config_value = useMemo(() => open_agent_config, [open_agent_config]);

  return <MainView>
    <OpenAgentConfigContext.Provider value={agent_config_value}>
      <ChatFilePanelProvider view_key={view_key} workspace_id={workspace_id} workspace_path={workspace_path}>
        <TurnFileDiffReviewProvider session_key={session_key} session_title={session_title} controller={controller}>{children}</TurnFileDiffReviewProvider>
      </ChatFilePanelProvider>
    </OpenAgentConfigContext.Provider>
  </MainView>;
}

/** resources 命名空间的翻译函数。 */
function useTranslation_resources() {
  return use_translation("resources");
}
