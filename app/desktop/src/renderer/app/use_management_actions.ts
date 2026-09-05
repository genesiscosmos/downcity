/**
 * Desktop 低频管理操作。
 *
 * 统一编排 Agent、Plugin、Workspace 基础信息、设置与账户操作；不处理 Chat、
 * Session 或 Group 的运行态，从而让根控制器只关注跨领域装配。
 */

import { useCallback, useMemo } from "react";
import type { DesktopSettings } from "@common/types/DesktopApi";
import type { CreateAgentFormValue, CreateWorkspaceFormValue } from "@/types/DesktopView";
import type { use_catalog_store } from "@/app/state/use_catalog_store";
import type { use_navigation_store } from "@/features/navigation/state/use_navigation_store";
import type { use_session_store } from "@/features/chat/state/use_session_store";
import type { use_settings_store } from "@/features/settings/state/use_settings_store";
import { normalize_global_env_text, to_error_message } from "@/features/settings/state/use_settings_store";
import { translate } from "@/locales/i18n";

const active_workspace_storage_key = "downcity.active_workspace_id";

/** 低频管理操作依赖。 */
interface DesktopManagementDependencies {
  /** Catalog 领域能力。 */
  catalog: ReturnType<typeof use_catalog_store>;
  /** 导航领域能力。 */
  navigation: ReturnType<typeof use_navigation_store>;
  /** Session 索引领域能力。 */
  session: ReturnType<typeof use_session_store>;
  /** 设置领域能力。 */
  settings: ReturnType<typeof use_settings_store>;
}

/** 创建 Agent、Plugin、Workspace、设置与账户操作。 */
export function use_desktop_management_actions({ catalog, navigation, session, settings }: DesktopManagementDependencies) {
  const refresh_models = useCallback(async () => {
    catalog.set_models_loading(true);
    try {
      catalog.set_models(await window.downcity.chat.list_models(), false);
    } catch (reason) {
      catalog.set_models([], false);
      settings.set_error(to_error_message(reason));
    }
  }, [catalog, settings]);

  const create_agent = useCallback(async (value: CreateAgentFormValue) => {
    settings.set_error("");
    const result = await window.downcity.agent.create(value);
    catalog.set_agents([...catalog.state_ref.current.agents.filter((item) => item.agent_id !== result.agent.agent_id), result.agent]);
    navigation.set_sidebar_mode("chat");
    navigation.set_selection({ kind: "agent", agent_id: result.agent.agent_id });
  }, [catalog, navigation, settings]);

  const get_agent = useCallback(async (agent_id: string) => await window.downcity.agent.get(agent_id), []);

  const update_agent = useCallback(async (agent_id: string, input: Parameters<typeof window.downcity.agent.update>[1]) => {
    settings.set_error("");
    try {
      const agent = await window.downcity.agent.update(agent_id, input);
      catalog.set_agents(catalog.state_ref.current.agents.map((item) => item.agent_id === agent.agent_id ? agent : item));
      catalog.set_plugins(await window.downcity.plugin.list());
    } catch (reason) {
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [catalog, settings]);

  const remove_agent = useCallback(async (agent_id: string) => {
    settings.set_error("");
    try {
      if (!await window.downcity.agent.remove(agent_id)) return;
      const next_agents = catalog.state_ref.current.agents.filter((agent) => agent.agent_id !== agent_id);
      catalog.set_agents(next_agents);
      const selection = navigation.state_ref.current.selection;
      if (selection && "agent_id" in selection && selection.agent_id === agent_id) {
        navigation.set_selection(next_agents[0] ? { kind: "agent", agent_id: next_agents[0].agent_id } : null);
      }
      session.remove_agent_sessions(agent_id);
      catalog.set_plugins(await window.downcity.plugin.list());
      const current_settings = settings.state_ref.current.settings;
      settings.set_settings(await window.downcity.settings.update({
        default_agent_id: current_settings.default_agent_id === agent_id ? "" : current_settings.default_agent_id,
        agent_main_sessions: Object.fromEntries(Object.entries(current_settings.agent_main_sessions).filter(([current_agent_id]) => current_agent_id !== agent_id)),
      }));
    } catch (reason) {
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [catalog, navigation, session, settings]);

  const update_agent_avatar = useCallback(async (agent_id: string, operation: "choose" | "remove" | "generate") => {
    settings.set_error("");
    try {
      const agent = operation === "choose"
        ? await window.downcity.agent.choose_avatar(agent_id)
        : operation === "remove"
          ? await window.downcity.agent.remove_avatar(agent_id)
          : await window.downcity.agent.generate_avatar(agent_id);
      if (agent) catalog.set_agents(catalog.state_ref.current.agents.map((item) => item.agent_id === agent.agent_id ? agent : item));
    } catch (reason) {
      settings.set_error(to_error_message(reason));
      throw reason;
    }
  }, [catalog, settings]);
  const choose_agent_avatar = useCallback((agent_id: string) => update_agent_avatar(agent_id, "choose"), [update_agent_avatar]);
  const remove_agent_avatar = useCallback((agent_id: string) => update_agent_avatar(agent_id, "remove"), [update_agent_avatar]);
  const generate_agent_avatar = useCallback((agent_id: string) => update_agent_avatar(agent_id, "generate"), [update_agent_avatar]);

  const get_plugin = useCallback(async (plugin_id: string) => await window.downcity.plugin.get(plugin_id), []);
  const create_plugin_profile = useCallback(async (plugin_id: string, input: Parameters<typeof window.downcity.plugin.create_profile>[1]) => {
    settings.set_error("");
    try {
      const definition = await window.downcity.plugin.create_profile(plugin_id, input);
      catalog.set_plugins(await window.downcity.plugin.list());
      return definition;
    } catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [catalog, settings]);
  const invoke_plugin_action = useCallback(async (plugin_id: string, input: Parameters<typeof window.downcity.plugin.invoke>[1]) => {
    settings.set_error("");
    try { return await window.downcity.plugin.invoke(plugin_id, input); }
    catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [settings]);
  const remove_plugin_profile = useCallback(async (plugin_id: string, profile_id: string) => {
    settings.set_error("");
    try {
      const definition = await window.downcity.plugin.remove_profile(plugin_id, profile_id);
      catalog.set_plugins(await window.downcity.plugin.list());
      return definition;
    } catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [catalog, settings]);

  const create_workspace = useCallback(async (value: CreateWorkspaceFormValue) => {
    settings.set_error("");
    const workspace = await window.downcity.workspace.create(value);
    catalog.add_workspace(workspace);
    navigation.set_sidebar_mode("workspace");
    navigation.set_active_workspace_id(workspace.workspace_id);
    localStorage.setItem(active_workspace_storage_key, workspace.workspace_id);
    navigation.set_selection({ kind: "workspace", workspace_id: workspace.workspace_id });
  }, [catalog, navigation, settings]);
  const update_workspace_name = useCallback(async (workspace_id: string, name: string) => {
    settings.set_error("");
    catalog.replace_workspace(await window.downcity.workspace.update_name(workspace_id, name));
  }, [catalog, settings]);
  const write_workspace_readme = useCallback(async (workspace_id: string, content: string) => {
    settings.set_error("");
    catalog.replace_workspace(await window.downcity.workspace.write_readme(workspace_id, content));
  }, [catalog, settings]);

  const update_settings = useCallback(async (patch: Partial<DesktopSettings>) => {
    try { settings.set_settings(await window.downcity.settings.update(patch)); }
    catch (reason) { settings.set_error(to_error_message(reason)); }
  }, [settings]);
  const list_global_env = useCallback(async () => {
    const next = normalize_global_env_text(await window.downcity.settings.list_env());
    settings.set_global_env(next);
    return next;
  }, [settings]);
  const update_global_env = useCallback(async (raw: string) => {
    try { settings.set_global_env(normalize_global_env_text(await window.downcity.settings.update_env(raw))); }
    catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [settings]);
  const list_login_providers = useCallback(async (federation_url: string, force_refresh = false) => {
    settings.set_error("");
    try { return await window.downcity.user.list_login_providers(federation_url, force_refresh); }
    catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [settings]);
  const login = useCallback(async (federation_url: string, provider_id: string) => {
    settings.set_error("");
    let pending_login_id = "";
    try {
      const started = await window.downcity.user.start_login({ federation_url, provider_id });
      pending_login_id = started.status === "done" ? "" : started.login_id;
      if (started.status === "input_required") throw new Error(translate("settings:login_errors.input_unsupported"));
      if (started.status !== "done") {
        let completed = false;
        for (let attempt = 0; attempt < 180; attempt += 1) {
          const result = await window.downcity.user.get_login_result(started.login_id);
          if (result.status === "error") throw new Error(result.error || translate("settings:login_errors.failed"));
          if (result.status === "done") { pending_login_id = ""; completed = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        if (!completed) throw new Error(translate("settings:login_errors.timeout"));
      }
      settings.set_user(await window.downcity.user.current());
      settings.set_accounts(await window.downcity.user.list_accounts());
      settings.set_account_resources(await window.downcity.user.get_resources());
      void refresh_models();
    } catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
    finally { if (pending_login_id) await window.downcity.user.cancel_login(pending_login_id).catch(() => undefined); }
  }, [refresh_models, settings]);
  const logout = useCallback(async () => {
    settings.set_error("");
    try {
      settings.set_user(await window.downcity.user.logout());
      settings.set_accounts(await window.downcity.user.list_accounts());
      settings.set_account_resources(undefined);
      catalog.set_models([], false);
    } catch (reason) { settings.set_error(to_error_message(reason)); }
  }, [catalog, settings]);
  const switch_account = useCallback(async (account_id: string) => {
    settings.set_error("");
    try {
      settings.set_user(await window.downcity.user.switch_account(account_id));
      settings.set_accounts(await window.downcity.user.list_accounts());
      settings.set_account_resources(await window.downcity.user.get_resources());
      await refresh_models();
    } catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [refresh_models, settings]);
  const remove_account = useCallback(async (account_id: string) => {
    settings.set_error("");
    try {
      settings.set_user(await window.downcity.user.remove_account(account_id));
      settings.set_accounts(await window.downcity.user.list_accounts());
      const current = await window.downcity.user.current();
      if (current.authenticated) settings.set_account_resources(await window.downcity.user.get_resources());
      else { settings.set_account_resources(undefined); catalog.set_models([], false); }
    } catch (reason) { settings.set_error(to_error_message(reason)); throw reason; }
  }, [catalog, settings]);

  return useMemo(() => ({
    refresh_models, create_agent, get_agent, update_agent, remove_agent, choose_agent_avatar,
    remove_agent_avatar, generate_agent_avatar, get_plugin, create_plugin_profile,
    invoke_plugin_action, remove_plugin_profile, create_workspace, update_workspace_name,
    write_workspace_readme, update_settings, list_global_env, update_global_env,
    list_login_providers, login, logout, switch_account, remove_account,
  }), [choose_agent_avatar, create_agent, create_plugin_profile, create_workspace, generate_agent_avatar, get_agent, get_plugin, invoke_plugin_action, list_global_env, list_login_providers, login, logout, refresh_models, remove_account, remove_agent, remove_agent_avatar, remove_plugin_profile, switch_account, update_agent, update_global_env, update_settings, update_workspace_name, write_workspace_readme]);
}
