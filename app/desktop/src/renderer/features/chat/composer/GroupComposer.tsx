/** 群聊输入只提供成员引用、会话切换和群聊提交能力。 */
import { TbArrowsDiagonal } from "react-icons/tb";
import { RichTextEditor } from "./RichTextEditor";
import { ComposerExpandButton, GroupComposerPanel, composer_tab_id } from "./ComposerPanel";
import { use_group_composer } from "./use_group_composer";
import { get_group_chat_key } from "../lib/chat_cache_key";
import { use_baybar_tab_active, type BayBarTab, type BayBarTranslate } from "@/layouts/BayBar";
import { use_translation } from "@/locales/i18n";
import type { GroupComposerProps } from "@/types/ChatComponents";

export function GroupComposer(props: GroupComposerProps) {
  const translate = use_translation("chat");
  const editor = use_group_composer(props);
  const { group_id, workspace_id } = props.selection;
  const session_id = props.selection.kind === "group_draft" ? props.selection.draft_id : props.selection.session_id;
  const chat_key = get_group_chat_key(workspace_id, group_id, session_id);
  // 与单聊同一条规则：面板打开时正文那一份卸载，避免两个编辑器争同一份草稿。
  const expanded = use_baybar_tab_active(composer_tab_id(chat_key));
  if (expanded) return null;
  return <RichTextEditor
    {...editor}
    expand={<ComposerExpandButton build_tab={() => group_composer_tab(props, translate)} />}
  />;
}

/**
 * 构造群聊的输入区标签页。
 *
 * 标题用 **Group 名**：群聊会话名对用户没有区分度，而 Group 名是用户自己起的。
 */
export function group_composer_tab(props: GroupComposerProps, t: BayBarTranslate): BayBarTab {
  const { group_id, workspace_id } = props.selection;
  const session_id = props.selection.kind === "group_draft" ? props.selection.draft_id : props.selection.session_id;
  // Group 名在目录 store 里可以同步读到（`get_snapshot`），因此标签页标题在点击处就能算好，
  // 不需要让内容组件反向去猜自己叫什么。
  const group_name = props.stores.catalog.get_snapshot().groups_by_id[group_id]?.name;
  return {
    id: composer_tab_id(get_group_chat_key(workspace_id, group_id, session_id)),
    label: group_name || t("conversation.new"),
    icon: <TbArrowsDiagonal />,
    sections: [{
      id: "composer",
      label: t("composer.panel_section"),
      content: <GroupComposerPanel selection={props.selection} stores={props.stores} actions={props.actions} />,
    }],
  };
}
