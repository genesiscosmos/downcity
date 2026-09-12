/** Agent Chat：MainView 组合内容与右侧「Agent」「本轮」两个域。 */
import { useMemo, useState, type ReactNode } from "react";

import type { SessionTurnFileDiffData, SessionTurnFileDiffSummary } from "@downcity/agent/session";

import type { DesktopController } from "@/types/DesktopView";
import type { DesktopAgentSummary } from "@common/types/DesktopApi";

import { MainView, type BayBarDomain } from "@/layouts/BayBar";

import { AGENT_DOMAIN_ID, AGENT_EDITOR_SECTIONS, AgentEditorPanel } from "@/features/agent/AgentView";
import { use_agent_definition } from "@/features/agent/lib/use_agent_definition";
import { FILE_DIFF_SECTION_ID, TURN_DOMAIN_ID, TurnFileDiffOverview, TurnFileDiffReviewPanel, TurnFileDiffReviewProvider } from "@/features/chat/components/messages/TurnFileDiffCard";
import { use_translation } from "@/locales/i18n";

/** Agent Chat MainView 属性。 */
interface AgentChatMainViewProps {
  /** 当前 Agent。 */
  agent: DesktopAgentSummary;
  /** Desktop 稳定控制器。 */
  controller: DesktopController;
  /** 当前 Chat 的稳定标识，用于按会话记忆显示位置。 */
  view_key: string;
  /** 当前轮次的文件改动摘要；为空时「本轮」域显示空态。 */
  file_diff_summary?: SessionTurnFileDiffSummary;
  /** 渲染 Chat 正文。 */
  children: ReactNode;
}

/**
 * Agent Chat 的右侧域。
 *
 * 「本轮」域始终存在：集合稳定，tab 条不会随有没有改动忽长忽短。
 */
export function AgentChatMainView({ agent, controller, view_key, file_diff_summary, children }: AgentChatMainViewProps) {
  const translate_resources = useTranslation_resources();
  const translate_chat = use_translation("chat");
  // 点击历史轮次的 diff 卡片时切换到这里指向的那一轮；否则展示当前轮摘要。
  const [review_data, set_review_data] = useState<SessionTurnFileDiffData>();
  const definition_state = use_agent_definition(agent.agent_id, controller);
  const domains = useMemo<BayBarDomain[]>(() => [
    {
      id: AGENT_DOMAIN_ID,
      label: translate_resources("agent.edit"),
      sections: AGENT_EDITOR_SECTIONS.map((item) => ({
        id: item.id,
        label: item.label_key ? translate_resources(item.label_key) : item.label ?? item.id,
        content: <AgentEditorPanel agent={agent} controller={controller} section={item.id} {...definition_state} />,
      })),
    },
    {
      id: TURN_DOMAIN_ID,
      label: translate_chat("file_diff.turn_label"),
      sections: [{
        id: FILE_DIFF_SECTION_ID,
        label: translate_chat("file_diff.tab_label"),
        content: review_data ? <TurnFileDiffReviewPanel data={review_data} /> : <TurnFileDiffOverview summary={file_diff_summary} />,
      }],
    },
  ], [agent, controller, definition_state, file_diff_summary, review_data, translate_chat, translate_resources]);

  return <MainView view_key={view_key} domains={domains}>
    {() => <TurnFileDiffReviewProvider open_review={set_review_data}>{children}</TurnFileDiffReviewProvider>}
  </MainView>;
}

/** resources 命名空间的翻译函数。 */
function useTranslation_resources() {
  return use_translation("resources");
}
