/**
 * 草稿输入区：上下文行（联系人与目录 chip）+ 正式会话输入卡片。
 *
 * ## 为什么这一行由草稿输入区提供、且排在卡片外面
 *
 * 「这条还没发出的对话发给谁、在哪个目录里跑」只在草稿阶段可换：会话一旦创建，
 * 目录就固定在标题栏标签上、联系人也不再改。因此取数放在草稿场景里。
 *
 * 位置是**卡片的同级兄弟**（排在卡片上方）而不是卡片内容：它们是进入输入前的选择，
 * 而卡片本身的语义是「一段正在写的输入」。几何由 `.chat-composer-context-row` 与卡片同源。
 */

import { useCallback } from "react";
import { RichTextEditor } from "./RichTextEditor";
import { ComposerExpandButton } from "./ComposerPanel";
import { use_agent_composer } from "./use_agent_composer";
import { agent_composer_tab } from "./SessionComposer";
import { ChatAgentSelector } from "@/features/chat/components/ChatAgentSelector";
import { ChatWorkspaceSelector } from "@/features/chat/components/ChatWorkspaceSelector";
import { ComposerContextRow } from "@/features/chat/components/ComposerContextRow";
import { use_desktop_selector } from "@/app/use_desktop";
import { use_translation } from "@/locales/i18n";
import type { AgentComposerProps } from "@/types/ChatComponents";

/** 草稿输入区：一行上下文 chip + 正式会话输入卡片。 */
export function DraftComposer(props: AgentComposerProps) {
  const editor = use_agent_composer(props);
  const translate_chat = use_translation("chat");
  const { workspace_id, agent_id } = props.selection;
  const agents = use_desktop_selector(props.stores.catalog, (state) => state.agents);
  const workspaces = use_desktop_selector(props.stores.catalog, (state) => state.workspaces);
  const switch_workspace = useCallback((target_workspace_id: string) => {
    props.actions.switch_draft_context(target_workspace_id, agent_id);
  }, [agent_id, props.actions]);
  // 草稿还没有正式会话名，标签页用统一的「新对话」（由 agent_composer_tab 兜底）。
  return <>
    <ComposerContextRow>
      <ChatAgentSelector
        agent_id={agent_id}
        agents={agents}
        disabled={false}
        switch_agent={(next_agent_id) => props.actions.switch_draft_context(workspace_id, next_agent_id)}
      />
      <ChatWorkspaceSelector
        workspace_id={workspace_id}
        workspaces={workspaces}
        disabled={false}
        variant="chip"
        switch_workspace={switch_workspace}
      />
    </ComposerContextRow>
    <RichTextEditor
      {...editor}
      expand={<ComposerExpandButton build_tab={() => agent_composer_tab(props, translate_chat)} />}
    />
  </>;
}
