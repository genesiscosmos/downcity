/**
 * 用户与偏好设置领域 store。
 *
 * 承载 Desktop 用户级设置、Global Env、Federation 用户与账户、账户资源、
 * 全局错误与首次加载状态。全部为低频数据。
 */

import { useCallback, useMemo } from "react";
import type {
  DesktopAccountResources,
  DesktopAccountSummary,
  DesktopSettings,
  DesktopUserSummary,
} from "@common/types/DesktopApi";
import type { SettingsStoreState } from "@/types/DesktopView";
import { use_store } from "./store_types";

const default_settings: DesktopSettings = {
  show_reasoning: true,
  auto_scroll: true,
  default_agent_id: "",
  open_empty_chat_on_start: false,
  send_message_on_enter: true,
  spellcheck_enabled: false,
  appearance_mode: "system",
  color_theme: "duobox",
  ui_scale: 1,
  proxy_enabled: false,
  proxy_url: "",
  default_text_model_id: "",
  default_image_model_id: "",
  agent_main_sessions: {},
  group_main_sessions: {},
};

const default_user: DesktopUserSummary = {
  authenticated: false,
  federation_url: "https://base.downcity.ai",
};

const initial_settings_state: SettingsStoreState = {
  settings: default_settings,
  global_env: "",
  user: default_user,
  accounts: [],
  error: "",
  loading: true,
};

/** 把未知失败统一转换为用户可见文本。 */
export function to_error_message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 把新版原文或旧版 key/value Env 响应统一收敛为编辑器文本。 */
export function normalize_global_env_text(input: unknown): string {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const lines = Object.entries(input).map(([key, value]) => `${key}=${String(value ?? "")}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** 创建用户与偏好设置领域 store。 */
export function use_settings_store() {
  const { store, state_ref, commit } = use_store<SettingsStoreState>(initial_settings_state);

  /** 替换 Desktop 用户级设置。 */
  const set_settings = useCallback((settings: DesktopSettings) => {
    if (Object.is(state_ref.current.settings, settings)) return;
    commit({ ...state_ref.current, settings });
  }, [commit]);

  /** 替换 Global Env 快照。 */
  const set_global_env = useCallback((global_env: string) => {
    if (state_ref.current.global_env === global_env) return;
    commit({ ...state_ref.current, global_env });
  }, [commit]);

  /** 替换当前 Federation 用户。 */
  const set_user = useCallback((user: DesktopUserSummary) => {
    if (Object.is(state_ref.current.user, user)) return;
    commit({ ...state_ref.current, user });
  }, [commit]);

  /** 替换全部已保存账户。 */
  const set_accounts = useCallback((accounts: DesktopAccountSummary[]) => {
    if (Object.is(state_ref.current.accounts, accounts)) return;
    commit({ ...state_ref.current, accounts });
  }, [commit]);

  /** 替换当前账户资源；无资源时置空。 */
  const set_account_resources = useCallback((account_resources: DesktopAccountResources | undefined) => {
    if (Object.is(state_ref.current.account_resources, account_resources)) return;
    commit({ ...state_ref.current, account_resources });
  }, [commit]);

  /** 设置用户可见的全局错误。 */
  const set_error = useCallback((error: string) => {
    if (state_ref.current.error === error) return;
    commit({ ...state_ref.current, error });
  }, [commit]);

  /** 清除用户可见的全局错误。 */
  const clear_error = useCallback(() => {
    if (!state_ref.current.error) return;
    commit({ ...state_ref.current, error: "" });
  }, [commit]);

  /** 替换首次加载状态。 */
  const set_loading = useCallback((loading: boolean) => {
    if (state_ref.current.loading === loading) return;
    commit({ ...state_ref.current, loading });
  }, [commit]);

  return useMemo(() => ({
    store,
    state_ref,
    set_settings,
    set_global_env,
    set_user,
    set_accounts,
    set_account_resources,
    set_error,
    clear_error,
    set_loading,
  }), [clear_error, set_account_resources, set_accounts, set_error, set_global_env, set_loading, set_settings, set_user, state_ref, store]);
}
