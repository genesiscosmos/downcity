/** 草稿输入只组合初始配置与首次发送，不构造正式会话操作。 */
import { RichTextEditor } from "./RichTextEditor";
import { use_agent_composer } from "./use_agent_composer";
import type { AgentComposerProps } from "@/types/ChatComponents";

export function DraftComposer(props: AgentComposerProps) {
  const editor = use_agent_composer(props);
  return <RichTextEditor {...editor} />;
}
