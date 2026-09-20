/** 群聊输入绑定：按会话读取草稿，为编辑器提供成员引用与提交能力。 */
import { useMemo } from "react";
import { use_store_selector } from "@/lib/store";
import { get_group_chat_key } from "../lib/chat_cache_key";
import { read_composer_focus_request } from "./editor/composerFocus";
import { empty_chat_content } from "../lib/chat_view_defaults";
import { is_group_phase_running } from "../lib/group/group_runtime_projection";
import type { GroupComposerProps, RichTextEditorProps } from "@/types/ChatComponents";
import type { ChatSlashCommand } from "@/types/ChatComposer";
import { use_translation } from "@/locales/i18n";

/** 绑定群聊草稿、成员引用与会话切换命令；与单聊的绑定同构。 */
export function use_group_composer({ selection, stores, actions }: GroupComposerProps): RichTextEditorProps {
  const translate = use_translation("chat");
  const { group_id, workspace_id } = selection;
  const session_id = selection.kind === "group_draft" ? selection.draft_id : selection.session_id;
  const chat_key = get_group_chat_key(workspace_id, group_id, session_id);
  const draft = use_store_selector(stores.composer, (state) => state.draft_content_by_session[chat_key]);
  const focus_request = use_store_selector(stores.composer, (state) => read_composer_focus_request(state.focus_request_by_session, chat_key));
  const group = use_store_selector(stores.catalog, (state) => state.groups_by_id[group_id]);
  const agents = use_store_selector(stores.catalog, (state) => state.agents);
  const spellcheck_enabled = use_store_selector(stores.settings, (state) => state.settings.spellcheck_enabled);
  const members = useMemo(() => agents.filter((agent) => group?.members.some((member) => member.agent_id === agent.agent_id)), [agents, group?.members]);
  const commands = useMemo<ChatSlashCommand[]>(
    () => (group?.sessions ?? []).map((session) => ({
      command_id: `sessions:${session.session_id}`,
      title: `/sessions ${session.session_id.slice(0, 8)}`,
      description: translate("commands.switch_group_session"),
      keywords: ["session", "sessions", session.session_id],
      run: () => actions.open_group(group_id, session.session_id),
    })),
    [actions, group?.sessions, group_id, translate],
  );
  // 群聊的「忙碌」看群阶段而不是单个 Session 运行态：这是 Group 的既有语义。
  const busy = use_store_selector(stores.chat_stream, (state) =>
    selection.kind === "group_session" && is_group_phase_running(state.group_phase_by_group[group_id]));
  return {
    editor_key: chat_key,
    draft_content: draft ?? empty_chat_content,
    focus_request,
    placeholder: translate("composer.group_placeholder"),
    busy,
    spellcheck_enabled,
    members,
    commands,
    update_draft: (input) => actions.update_group_draft(workspace_id, group_id, session_id, input),
    send_message: async (input) => { await actions.send_group_message(group_id, workspace_id, session_id, input); },
    stop_session: selection.kind === "group_session" ? () => actions.stop_group(group_id, session_id) : undefined,
  };
}
