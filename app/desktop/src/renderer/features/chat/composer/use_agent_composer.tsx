/** 单聊输入绑定：按会话读取草稿和配置，为编辑器提供明确的输入能力。 */
import { useMemo } from "react";
import { use_store_selector } from "@/lib/store";
import { get_session_key } from "@/features/chat/lib/chat_cache_key";
import { empty_chat_content } from "@/features/chat/lib/chat_view_defaults";
import { read_composer_focus_request } from "@/features/chat/composer/editor/composerFocus";
import { ChatModelSelector } from "./ChatModelSelector";
import { ChatApprovalModeSelector } from "./ChatApprovalModeSelector";
import type { AgentComposerProps, RichTextEditorProps } from "@/types/ChatComponents";
import type { ChatSlashCommand } from "@/types/ChatComposer";
import { use_translation } from "@/locales/i18n";

/** 绑定模型和草稿；消息列表不参与输入区域的订阅。 */
export function use_agent_composer({ selection, stores, actions }: AgentComposerProps): RichTextEditorProps {
  const translate = use_translation("chat");
  const { workspace_id, agent_id } = selection;
  const session_id = selection.kind === "draft" ? selection.draft_id : selection.session_id;
  const session_key = get_session_key(workspace_id, agent_id, session_id);
  const draft = use_store_selector(stores.composer, state => state.draft_content_by_session[session_key]);
  const focus_request = use_store_selector(stores.composer, state => read_composer_focus_request(state.focus_request_by_session, session_key));
  const configuration = use_store_selector(stores.chat_stream, state => state.configuration_by_session[session_key]);
  const agent = use_store_selector(stores.catalog, state => state.agents.find(item => item.agent_id === agent_id));
  const models = use_store_selector(stores.catalog, state => state.models);
  const models_loading = use_store_selector(stores.catalog, state => state.models_loading);
  const spellcheck_enabled = use_store_selector(stores.settings, state => state.settings.spellcheck_enabled);
  const default_model_id = use_store_selector(stores.settings, state => state.settings.default_text_model_id);
  const attachments = useMemo(() => ({
    list_files: () => window.downcity.chat.list_workspace_files(workspace_id),
    read_file: (relative_path: string) => window.downcity.chat.read_workspace_file(workspace_id, relative_path),
  }), [workspace_id]);
  const set_model = (model_id: string) => actions.set_session_model(workspace_id, agent_id, session_id, model_id);
  const set_reasoning_effort = (effort?: string) => actions.set_session_reasoning_effort(workspace_id, agent_id, session_id, effort);
  const set_approval_mode = (mode: "ask" | "always-allow") => actions.set_session_approval_mode(workspace_id, agent_id, session_id, mode);
  const commands: ChatSlashCommand[] = [
    ...models.map(model => ({ command_id: `model:${model.model_id}`, title: `/model ${model.name}`, description: translate("commands.switch_model", { model: model.model_id }), keywords: ["model", model.model_id], run: () => set_model(model.model_id) })),
    ...(["ask", "always-allow"] as const).map(mode => ({ command_id: `approval:${mode}`, title: `/approval ${mode}`, description: translate(mode === "ask" ? "commands.ask_before_run" : "commands.allow_automatically"), keywords: ["approval"], run: () => set_approval_mode(mode) })),
  ];
  // 新对话默认跟随 Agent 配置的模型；全局默认模型只作为兜底。
  const effective_configuration = configuration ?? { model_id: agent?.model_id || default_model_id || "", approval_mode: "ask" as const };
  return {
    editor_key: session_key,
    draft_content: draft ?? empty_chat_content,
    focus_request,
    placeholder: translate("composer.placeholder"),
    busy: false,
    spellcheck_enabled,
    update_draft: input => actions.update_draft(workspace_id, agent_id, session_id, input),
    send_message: (input, mode = "send") => actions.send_message(workspace_id, agent_id, session_id, input, mode),
    attachments,
    commands,
    toolbar: <>
      {agent ? <ChatModelSelector agent={agent} configuration={effective_configuration} models={models} models_loading={models_loading} set_model={set_model} set_reasoning_effort={set_reasoning_effort} /> : null}
      <ChatApprovalModeSelector configuration={effective_configuration} set_approval_mode={set_approval_mode} />
    </>,
  };
}
