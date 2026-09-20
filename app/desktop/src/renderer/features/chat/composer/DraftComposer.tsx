/** 草稿输入只组合初始配置与首次发送，不构造正式会话操作。 */
import { RichTextEditor } from "./RichTextEditor";
import { ComposerExpandButton } from "./ComposerPanel";
import { use_agent_composer } from "./use_agent_composer";
import { agent_composer_tab } from "./SessionComposer";
import { use_translation } from "@/locales/i18n";
import type { AgentComposerProps } from "@/types/ChatComponents";

export function DraftComposer(props: AgentComposerProps) {
  const editor = use_agent_composer(props);
  const translate_chat = use_translation("chat");
  // 草稿还没有正式会话名，标签页用统一的「新对话」（由 agent_composer_tab 兜底）。
  return <RichTextEditor
    {...editor}
    expand={<ComposerExpandButton build_tab={() => agent_composer_tab(props, translate_chat)} />}
  />;
}
