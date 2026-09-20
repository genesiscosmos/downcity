/** 群聊输入只提供成员引用、会话切换和群聊提交能力。 */
import { TbArrowsDiagonal } from "react-icons/tb";
import { RichTextEditor } from "./RichTextEditor";
import { ComposerExpandButton, GroupComposerPanel, composer_tab_id } from "./ComposerPanel";
import { use_group_composer } from "./use_group_composer";
import { get_group_chat_key } from "../lib/chat_cache_key";
import { use_baybar_set_tab_label, use_baybar_tab_active, type BayBarTab, type BayBarTranslate } from "@/layouts/BayBar";
import { useEffect } from "react";
import { use_translation } from "@/locales/i18n";
import type { GroupComposerProps } from "@/types/ChatComponents";

export function GroupComposer(props: GroupComposerProps) {
  const translate = use_translation("chat");
  const editor = use_group_composer(props);
  const { group_id, workspace_id } = props.selection;
  const session_id = props.selection.kind === "group_draft" ? props.selection.draft_id : props.selection.session_id;
  const chat_key = get_group_chat_key(workspace_id, group_id, session_id);
  // 与单聊同一条规则：面板打开时正文那一份卸载，避免两个编辑器争同一份草稿。
  const tab_id = composer_tab_id(chat_key);
  const expanded = use_baybar_tab_active(tab_id);
  // 与单聊同理：会话标题异步产生，展开后持续同步回标签页（本组件展开时仍然挂载）。
  const set_tab_label = use_baybar_set_tab_label();
  const label = props.session_label || translate("conversation.new");
  useEffect(() => { set_tab_label(tab_id, label); }, [label, set_tab_label, tab_id]);
  if (expanded) return null;
  return <RichTextEditor
    {...editor}
    expand={<ComposerExpandButton build_tab={() => group_composer_tab(props, translate)} />}
  />;
}

/**
 * 构造群聊的输入区标签页。
 *
 * 标题用**群聊会话名**，与单聊保持同一口径：标签行上可能同时开着多个会话的输入区，
 * 能区分它们的只有会话名。草稿还没有名字时由调用方给兜底文案。
 */
export function group_composer_tab(props: GroupComposerProps, t: BayBarTranslate): BayBarTab {
  const { group_id, workspace_id } = props.selection;
  const session_id = props.selection.kind === "group_draft" ? props.selection.draft_id : props.selection.session_id;
  return {
    id: composer_tab_id(get_group_chat_key(workspace_id, group_id, session_id)),
    label: props.session_label || t("conversation.new"),
    icon: <TbArrowsDiagonal />,
    sections: [{
      id: "composer",
      label: t("composer.panel_section"),
      content: <GroupComposerPanel selection={props.selection} stores={props.stores} actions={props.actions} />,
    }],
  };
}
