/** Desktop Group 导航、会话与消息编排。 */

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { RespondSessionInteractionInput } from "@downcity/agent";
import type { JSONContent } from "@tiptap/core";
import type { DesktopCreateGroupInput, DesktopUpdateGroupInput } from "@common/types/DesktopApi";
import { read_chat_composer_text } from "@/features/chat/composer/editor/chatComposerCodec";
import { update_group_session_title } from "@/features/chat/lib/group/group_session_projection";
import { get_group_chat_key } from "@/features/chat/lib/chat_cache_key";
import { get_group_draft_session_id, is_group_draft_session_id } from "@/types/DesktopView";
import type { use_catalog_store } from "@/app/state/use_catalog_store";
import type { use_chat_stream_store } from "@/features/chat/state/use_chat_stream_store";
import type { use_composer_store } from "@/features/chat/state/use_composer_store";
import type { use_navigation_store } from "@/features/navigation/state/use_navigation_store";
import type { use_settings_store } from "@/features/settings/state/use_settings_store";
import { translate } from "@/locales/i18n";
import { to_error_message } from "@/features/settings/state/use_settings_store";

const active_workspace_storage_key = "downcity.active_workspace_id";

/** Group 编排依赖。 */
interface DesktopGroupDependencies {
  /** Catalog 能力。 */ catalog: ReturnType<typeof use_catalog_store>;
  /** Chat 流式能力。 */ chat_stream: ReturnType<typeof use_chat_stream_store>;
  /** 输入草稿能力。 */ composer: ReturnType<typeof use_composer_store>;
  /** 导航能力。 */ navigation: ReturnType<typeof use_navigation_store>;
  /** 设置与错误能力。 */ settings: ReturnType<typeof use_settings_store>;
  /** 当前激活的 GroupSession 映射。 */ active_group_session_ids_ref: RefObject<Map<string, string>>;
  /** 已完成恢复的导航键集合。 */ hydrated_navigation_keys_ref: RefObject<Set<string>>;
}

/** 创建 Group 领域的稳定操作集合。 */
export function use_desktop_group_actions(dependencies: DesktopGroupDependencies) {
  const { catalog, chat_stream, composer, navigation, settings, active_group_session_ids_ref, hydrated_navigation_keys_ref } = dependencies;
  const group_navigation_request_ref = useRef(0);
  const resolve_chat_workspace = useCallback(async (preferred_workspace_id?: string) => {
    const current_workspaces = catalog.state_ref.current.workspaces;
    const target_workspace = current_workspaces.find((workspace) => workspace.workspace_id === preferred_workspace_id)
      ?? current_workspaces.find((workspace) => workspace.workspace_id === navigation.state_ref.current.active_workspace_id)
      ?? current_workspaces[0]
      ?? await window.downcity.workspace.get_default();
    if (!current_workspaces.some((workspace) => workspace.workspace_id === target_workspace.workspace_id)) catalog.add_workspace(target_workspace);
    return target_workspace;
  }, [catalog, navigation]);
  const open_group_draft = useCallback(async (group_id: string, workspace_id?: string, parent_request_id?: number) => {
    const request_id = parent_request_id ?? group_navigation_request_ref.current + 1;
    const initial_selection = navigation.state_ref.current.selection;
    if (parent_request_id === undefined) group_navigation_request_ref.current = request_id;
    else if (group_navigation_request_ref.current !== parent_request_id) return;
    const workspace = await resolve_chat_workspace(workspace_id);
    if (group_navigation_request_ref.current !== request_id || navigation.state_ref.current.selection !== initial_selection) return;
    const draft_id = get_group_draft_session_id(group_id);
    active_group_session_ids_ref.current.delete(group_id);
    navigation.set_sidebar_mode("chat");
    chat_stream.reset_group_chat(group_id);
    navigation.set_active_workspace_id(workspace.workspace_id);
    localStorage.setItem(active_workspace_storage_key, workspace.workspace_id);
    navigation.set_selection({ kind: "group_draft", group_id, workspace_id: workspace.workspace_id, draft_id });
    // Group 新对话的输入框随后才挂载，因此先登记一次聚焦请求，键盘焦点直接进入输入框。
    composer.request_focus(get_group_chat_key(workspace.workspace_id, group_id, draft_id));
  }, [active_group_session_ids_ref, chat_stream, composer, navigation, resolve_chat_workspace]);
  const open_group = useCallback(async (group_id: string, session_id?: string) => {
    const request_id = group_navigation_request_ref.current + 1;
    const initial_selection = navigation.state_ref.current.selection;
    group_navigation_request_ref.current = request_id;
    settings.set_error("");
    try {
      const summaries = await window.downcity.group.list_sessions(group_id);
      if (group_navigation_request_ref.current !== request_id || navigation.state_ref.current.selection !== initial_selection) return;
      const target_session_id = session_id ?? summaries.slice().sort((left, right) => right.updated_at - left.updated_at)[0]?.session_id;
      if (!target_session_id) return await open_group_draft(group_id, undefined, request_id);
      const group = await window.downcity.group.open(group_id, target_session_id);
      const active_session = group.sessions.find((item) => item.session_id === group.active_session_id);
      if (!active_session?.workspace_id || !group.active_session_id) throw new Error(translate("chat:errors.group_workspace_required"));
      const messages = await window.downcity.group.list_messages(group_id, group.active_session_id);
      if (group_navigation_request_ref.current !== request_id || navigation.state_ref.current.selection !== initial_selection) return;
      catalog.upsert_group(group);
      active_group_session_ids_ref.current.set(group_id, group.active_session_id);
      chat_stream.reset_group_chat(group_id);
      chat_stream.set_group_messages(group_id, messages);
      navigation.set_active_workspace_id(active_session.workspace_id);
      localStorage.setItem(active_workspace_storage_key, active_session.workspace_id);
      hydrated_navigation_keys_ref.current.add(`group:${group_id}:${group.active_session_id}`);
      navigation.set_selection({ kind: "group_session", group_id, workspace_id: active_session.workspace_id, session_id: group.active_session_id });
    } catch (reason) {
      if (group_navigation_request_ref.current === request_id) settings.set_error(to_error_message(reason));
    }
  }, [active_group_session_ids_ref, catalog, chat_stream, hydrated_navigation_keys_ref, navigation, open_group_draft, settings]);
  useEffect(() => {
    const hydrate_group_session = () => {
      const selection = navigation.state_ref.current.selection;
      if (selection?.kind !== "group_session") return;
      const navigation_key = `group:${selection.group_id}:${selection.session_id}`;
      if (hydrated_navigation_keys_ref.current.has(navigation_key)) return;
      hydrated_navigation_keys_ref.current.add(navigation_key);
      void open_group(selection.group_id, selection.session_id);
    };
    hydrate_group_session();
    return navigation.store.subscribe(hydrate_group_session);
  }, [hydrated_navigation_keys_ref, navigation, open_group]);
  const create_group_session = useCallback(async (group_id: string, workspace_id?: string) => {
    settings.set_error("");
    try { await open_group_draft(group_id, workspace_id); }
    catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [open_group_draft, settings]);
  const switch_group_draft_context = useCallback(async (group_id: string, workspace_id: string) => {
    const selection = navigation.state_ref.current.selection;
    if (selection?.kind !== "group_draft" || selection.group_id !== group_id || selection.workspace_id === workspace_id) return;
    composer.move_draft(get_group_chat_key(selection.workspace_id, group_id, selection.draft_id), get_group_chat_key(workspace_id, group_id, selection.draft_id));
    await open_group_draft(group_id, workspace_id);
  }, [composer, navigation, open_group_draft]);
  const rename_group_session = useCallback(async (group_id: string, session_id: string, title: string) => {
    try {
      const normalized_title = await window.downcity.group.rename_session(group_id, session_id, title);
      const groups = catalog.state_ref.current.groups.map((group) => update_group_session_title(group, group_id, session_id, normalized_title));
      catalog.set_groups(groups);
    } catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [catalog, settings]);
  const remove_group_session = useCallback(async (group_id: string, session_id: string) => {
    settings.set_error("");
    try {
      const removed_session = catalog.state_ref.current.groups_by_id[group_id]?.sessions.find((item) => item.session_id === session_id);
      const group = await window.downcity.group.remove_session(group_id, session_id);
      if (removed_session?.workspace_id) composer.remove_draft(get_group_chat_key(removed_session.workspace_id, group_id, session_id));
      catalog.upsert_group(group); chat_stream.reset_group_chat(group_id);
      const next_session = group.sessions.find((item) => item.session_id === group.active_session_id);
      if (settings.state_ref.current.settings.group_main_sessions[group_id]?.session_id === session_id) {
        const next_group_main_sessions = { ...settings.state_ref.current.settings.group_main_sessions };
        delete next_group_main_sessions[group_id];
        settings.set_settings(await window.downcity.settings.update({ group_main_sessions: next_group_main_sessions }));
      }
      const selection = navigation.state_ref.current.selection;
      if (selection?.kind === "group_session" && selection.group_id === group_id && selection.session_id === session_id) {
        if (next_session?.workspace_id && group.active_session_id) await open_group(group.group_id, group.active_session_id);
        else await open_group_draft(group_id, selection.workspace_id);
      }
    } catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [catalog, chat_stream, composer, navigation, open_group, open_group_draft, settings]);
  const send_group_message = useCallback(async (group_id: string, workspace_id: string, session_id: string, input: JSONContent) => {
    const normalized_text = read_chat_composer_text(input, true);
    if (!normalized_text) return undefined;
    settings.set_error("");
    const source_key = get_group_chat_key(workspace_id, group_id, session_id);
    let target_key = source_key;
    composer.remove_draft(source_key); chat_stream.set_group_member_statuses(group_id, []);
    try {
      let target_session_id = session_id;
      if (is_group_draft_session_id(session_id)) {
        const group = await window.downcity.group.create_session(group_id, workspace_id);
        const created_session = group.sessions.find((item) => item.session_id === group.active_session_id);
        if (!group.active_session_id || created_session?.workspace_id !== workspace_id) throw new Error(translate("chat:errors.group_session_create_failed"));
        target_session_id = group.active_session_id;
        target_key = get_group_chat_key(workspace_id, group_id, target_session_id);
        active_group_session_ids_ref.current.set(group_id, target_session_id);
        catalog.upsert_group(group); chat_stream.reset_group_chat(group_id);
        hydrated_navigation_keys_ref.current.add(`group:${group_id}:${target_session_id}`);
        navigation.set_selection({ kind: "group_session", group_id, workspace_id, session_id: target_session_id });
      }
      return (await window.downcity.group.send(group_id, target_session_id, { text: normalized_text })).turn_id;
    } catch (reason) { composer.set_draft(target_key, input); settings.set_error(to_error_message(reason)); return undefined; }
  }, [active_group_session_ids_ref, catalog, chat_stream, composer, hydrated_navigation_keys_ref, navigation, settings]);
  const update_group_draft = useCallback((workspace_id: string, group_id: string, session_id: string, input: JSONContent) => composer.set_draft(get_group_chat_key(workspace_id, group_id, session_id), input), [composer]);
  const stop_group = useCallback(async (group_id: string, session_id: string) => {
    settings.set_error("");
    try { await window.downcity.group.stop(group_id, session_id); }
    catch (reason) { settings.set_error(to_error_message(reason)); }
  }, [settings]);
  const respond_group_interaction = useCallback(async (group_id: string, session_id: string, input: RespondSessionInteractionInput) => {
    await window.downcity.group.respond_interaction(group_id, session_id, input);
    chat_stream.remove_group_interaction(group_id, input.interaction_id);
  }, [chat_stream]);
  const create_group = useCallback(async (input: DesktopCreateGroupInput) => {
    settings.set_error("");
    try {
      const group = await window.downcity.group.create(input);
      catalog.upsert_group(group);
      navigation.set_sidebar_mode("chat"); navigation.set_selection({ kind: "group", group_id: group.group_id });
    } catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [catalog, navigation, settings]);
  const open_create_group = useCallback(() => { settings.set_error(""); navigation.set_sidebar_mode("chat"); navigation.set_selection({ kind: "create_group" }); }, [navigation, settings]);
  const update_group = useCallback(async (group_id: string, input: DesktopUpdateGroupInput) => {
    settings.set_error("");
    try { const group = await window.downcity.group.update(group_id, input); catalog.upsert_group(group); chat_stream.reset_group_chat(group_id); }
    catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [catalog, chat_stream, settings]);
  const remove_group = useCallback(async (group_id: string) => {
    settings.set_error("");
    try {
      await window.downcity.group.remove(group_id);
      catalog.remove_group(group_id); chat_stream.remove_group(group_id); active_group_session_ids_ref.current.delete(group_id);
      const selection = navigation.state_ref.current.selection;
      if ((selection?.kind === "group" || selection?.kind === "group_session" || selection?.kind === "group_draft") && selection.group_id === group_id) navigation.set_selection(null);
    } catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [active_group_session_ids_ref, catalog, chat_stream, navigation, settings]);
  return useMemo(() => ({ open_group, create_group_session, switch_group_draft_context, rename_group_session, remove_group_session, send_group_message, update_group_draft, stop_group, respond_group_interaction, create_group, open_create_group, update_group, remove_group }), [create_group, create_group_session, open_create_group, open_group, remove_group, remove_group_session, rename_group_session, respond_group_interaction, send_group_message, stop_group, switch_group_draft_context, update_group, update_group_draft]);
}
