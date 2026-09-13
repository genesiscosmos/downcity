/** 群聊输入只提供成员引用、会话切换和群聊提交能力。 */
import { useMemo } from "react";
import { RichTextEditor } from "./RichTextEditor";
import { use_store_selector } from "@/lib/store";
import { get_group_chat_key } from "../lib/chat_cache_key";
import { empty_chat_content } from "../lib/chat_view_defaults";
import { is_group_phase_running } from "../lib/group/group_runtime_projection";
import type { GroupComposerProps } from "@/types/ChatComponents";
import { use_translation } from "@/locales/i18n";

export function GroupComposer({ selection, stores, actions }: GroupComposerProps) {
  const translate = use_translation("chat");
  const { group_id, workspace_id } = selection;
  const session_id = selection.kind === "group_draft" ? selection.draft_id : selection.session_id;
  const chat_key = get_group_chat_key(workspace_id, group_id, session_id);
  const draft = use_store_selector(stores.composer, state => state.draft_content_by_session[chat_key]);
  const group = use_store_selector(stores.catalog, state => state.groups_by_id[group_id]);
  const agents = use_store_selector(stores.catalog, state => state.agents);
  const busy = use_store_selector(stores.chat_stream, state =>
    selection.kind === "group_session" && is_group_phase_running(state.group_phase_by_group[group_id]));
  const spellcheck_enabled = use_store_selector(stores.settings, state => state.settings.spellcheck_enabled);
  const members = useMemo(() => agents.filter(agent => group?.members.some(member => member.agent_id === agent.agent_id)), [agents, group?.members]);
  const commands = useMemo(() => (group?.sessions ?? []).map(session => ({ command_id: `sessions:${session.session_id}`, title: `/sessions ${session.session_id.slice(0, 8)}`, description: translate("commands.switch_group_session"), keywords: ["session", "sessions", session.session_id], run: () => actions.open_group(group_id, session.session_id) })), [actions, group?.sessions, group_id, translate]);
  return <RichTextEditor editor_key={chat_key} draft_content={draft ?? empty_chat_content}
    placeholder={translate("composer.group_placeholder")} busy={busy} spellcheck_enabled={spellcheck_enabled}
    members={members} commands={commands}
    update_draft={input => actions.update_group_draft(workspace_id, group_id, session_id, input)}
    send_message={async input => { await actions.send_group_message(group_id, workspace_id, session_id, input); }}
    stop_session={selection.kind === "group_session" ? () => actions.stop_group(group_id, session_id) : undefined} />;
}
