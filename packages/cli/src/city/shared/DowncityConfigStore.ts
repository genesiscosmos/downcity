/**
 * Downcity 本地配置存储。
 *
 * 关键点（中文）
 * - 只负责读取/写入 Downcity 保存的 Downtown 与 Downtown Session。
 * - 用户配置与 `fed` 管理端配置共用 `downcity.db`，但使用独立配置 key。
 * - 不包含交互菜单、输出渲染或用户身份校验逻辑。
 */

import { with_cli_local_data } from "@/city/runtime/LocalData.js";
import type { DowntownProfile } from "@/city/types/DowntownMembership.js";
import type { DowntownUserSession } from "@/city/types/DowntownSession.js";
import type { CliLocale } from "@/shared/types/CliLocale.js";
import type {
  DowntownAdminConfig,
  DowncityDowntownProfile,
  DowncityConfig,
} from "@/city/types/DowncityConfig.js";

/** 默认 Downtown 地址。 */
export const DEFAULT_DOWNTOWN_URL = "https://base.downcity.ai";

const DOWNCITY_CONFIG_KEY = "downcity.config";
const DOWNTOWN_CONFIG_KEY = "downtown.config";

/**
 * 读取字符串字段。
 */
export function read_downcity_string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 规范化 Downtown URL。
 */
export function normalize_downtown_url(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const has_protocol = /^[a-z][a-z\d+.-]*:///iu.test(raw);
  const with_protocol = has_protocol ? raw : `${default_protocol(raw)}://${raw}`;
  const url = new URL(with_protocol);
  if (
    !url.port &&
    (url.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/u.test(url.hostname))
  ) {
    url.port = "43127";
  }
  return url.toString().replace(/\/+$/, "");
}

/**
 * 读取当前 Downcity 本地安全配置。
 */
export function read_downcity_config(): DowncityConfig {
  return with_cli_local_data((data) =>
    normalize_downcity_config(data.settings.get<DowncityConfig>(DOWNCITY_CONFIG_KEY))
  );
}

/**
 * 写入 Downcity 本地配置。
 */
export function write_downcity_config(state: DowncityConfig): void {
  with_cli_local_data((data) =>
    data.settings.set(DOWNCITY_CONFIG_KEY, normalize_downcity_config(state))
  );
}

/**
 * 读取 Downcity 持久化的 CLI 语言。
 */
export function read_persisted_downcity_cli_locale(): CliLocale | undefined {
  return read_downcity_config().cli_locale;
}

/**
 * 写入 Downcity 持久化的 CLI 语言。
 */
export function write_persisted_downcity_cli_locale(cli_locale: CliLocale): void {
  const state = read_downcity_config();
  write_downcity_config({
    ...state,
    cli_locale,
  });
}

/**
 * 读取当前选中的 Downtown URL。
 */
export function resolve_selected_downtown_url(state: DowncityConfig = read_downcity_config()): string {
  return normalize_downtown_url(read_downcity_string(state.selected_downtown_url)) || DEFAULT_DOWNTOWN_URL;
}

/**
 * 读取当前选中 Downtown 的 user session。
 */
export function read_current_downtown_session(): DowntownUserSession | null {
  const state = read_downcity_config();
  const downtown_url = resolve_selected_downtown_url(state);
  return state.sessions?.[downtown_url] ?? null;
}

/**
 * 读取指定 Downtown 的 user session。
 */
export function read_downtown_session_for_downtown(downtown_url: string): DowntownUserSession | null {
  const state = read_downcity_config();
  const normalized_url = normalize_downtown_url(downtown_url);
  if (!normalized_url) return null;
  return state.sessions?.[normalized_url] ?? null;
}

/**
 * 添加或更新 Downcity 本地 Downtown 配置。
 */
export function upsert_downtown_profile(state: DowncityConfig, input: {
  /**
   * Downtown URL。
   */
  downtown_url: string;

  /**
   * 可选展示名。
   */
  name?: string;
}): DowncityConfig {
  const downtown_url = normalize_downtown_url(input.downtown_url);
  if (!downtown_url) return state;
  const profiles = [...(state.profiles ?? [])];
  const index = profiles.findIndex((item) => item.downtown_url === downtown_url);
  const profile = {
    name: read_downcity_string(input.name) || derive_downtown_name(downtown_url),
    downtown_url,
  };
  if (index >= 0) profiles[index] = profile;
  else profiles.push(profile);
  return {
    ...state,
    selected_downtown_url: downtown_url,
    profiles,
  };
}

/**
 * 列出 Downcity 可选择的 Downtown。
 *
 * 说明（中文）
 * - 这里只返回 Downcity 本地保存或 `fed` admin 保存过的 Downtown。
 * - 默认 Downtown 只作为未选择时的运行期 fallback，不再作为“已配置项”展示。
 */
export function list_downtowns(): DowntownProfile[] {
  const state = read_downcity_config();
  const selected_url = resolve_selected_downtown_url(state);
  const admin_servers = read_downtown_admin_profiles();
  const by_url = new Map<string, DowntownProfile>();

  const append = (profile: DowntownProfile): void => {
    const existing = by_url.get(profile.downtown_url);
    if (!existing) {
      by_url.set(profile.downtown_url, profile);
      return;
    }
    by_url.set(profile.downtown_url, {
      ...existing,
      selected: existing.selected || profile.selected,
      source: existing.source === "downcity-profile" ? "downcity-profile" : profile.source,
      has_admin_session: existing.has_admin_session || profile.has_admin_session,
      has_user_session: existing.has_user_session || profile.has_user_session,
      user_id: existing.user_id || profile.user_id,
    });
  };

  for (const profile of state.profiles ?? []) {
    const session = state.sessions?.[profile.downtown_url];
    append({
      name: profile.name,
      downtown_url: profile.downtown_url,
      selected: profile.downtown_url === selected_url,
      source: "downcity-profile",
      has_admin_session: Boolean(read_downtown_admin_session_for_url(profile.downtown_url)),
      has_user_session: Boolean(session?.user_token),
      user_id: session?.user_id,
    });
  }

  for (const server of admin_servers) append(server);

  return [...by_url.values()].sort((left, right) =>
    Number(right.selected) - Number(left.selected)
    || left.name.localeCompare(right.name)
    || left.downtown_url.localeCompare(right.downtown_url),
  );
}

/**
 * 读取指定 Downtown 尚未到期的管理员 Session Token。
 */
export function read_downtown_admin_session_for_url(downtown_url: string): string | undefined {
  const target_url = normalize_downtown_url(downtown_url);
  const raw = read_downtown_admin_config();
  const servers = Array.isArray(raw.servers) ? raw.servers : [];
  const matched = servers.find((item) =>
    normalize_downtown_url(read_downcity_string(item.base_url)) === target_url,
  );
  const expires_at = read_downcity_string(matched?.admin_session_expires_at);
  if (!expires_at || Date.parse(expires_at) <= Date.now()) return undefined;
  return read_downcity_string(matched?.admin_session_token) || undefined;
}

function default_protocol(value: string): "http" | "https" {
  const host = value.split("/")[0] ?? "";
  const clean_host = host.split(":")[0] ?? "";
  if (
    clean_host === "localhost" ||
    clean_host.includes(":") ||
    clean_host.split(".").length === 4
  ) {
    return "http";
  }
  return "https";
}

/**
 * 从 Downtown URL 推导展示名称。
 */
function derive_downtown_name(downtown_url: string): string {
  try {
    return new URL(downtown_url).hostname || downtown_url;
  } catch {
    return downtown_url;
  }
}

function read_downtown_admin_config(): DowntownAdminConfig {
  return with_cli_local_data((data) =>
    data.settings.get<DowntownAdminConfig>(DOWNTOWN_CONFIG_KEY) ?? {}
  );
}

function read_downtown_admin_profiles(): DowntownProfile[] {
  const raw = read_downtown_admin_config();
  const servers = Array.isArray(raw.servers) ? raw.servers : [];
  const out: DowntownProfile[] = [];
  const state = read_downcity_config();
  const selected_url = resolve_selected_downtown_url(state);

  for (const item of servers) {
    const downtown_url = normalize_downtown_url(read_downcity_string(item.base_url));
    if (!downtown_url || out.some((server) => server.downtown_url === downtown_url)) continue;
    const session = state.sessions?.[downtown_url];
    out.push({
      name: read_downcity_string(item.name) || derive_downtown_name(downtown_url),
      downtown_url,
      selected: downtown_url === selected_url,
      source: "downtown-admin",
      has_admin_session: Boolean(
        read_downcity_string(item.admin_session_token)
        && Date.parse(read_downcity_string(item.admin_session_expires_at)) > Date.now(),
      ),
      has_user_session: Boolean(session?.user_token),
      user_id: session?.user_id,
    });
  }

  return out.sort((left, right) =>
    left.name.localeCompare(right.name)
    || left.downtown_url.localeCompare(right.downtown_url),
  );
}

function normalize_downcity_config(value: DowncityConfig | null | undefined): DowncityConfig {
  const selected_downtown_url = normalize_downtown_url(read_downcity_string(value?.selected_downtown_url));
  const profiles: DowncityDowntownProfile[] = [];
  for (const item of Array.isArray(value?.profiles) ? value.profiles : []) {
    const downtown_url = normalize_downtown_url(read_downcity_string(item.downtown_url));
    if (!downtown_url || profiles.some((profile) => profile.downtown_url === downtown_url)) continue;
    profiles.push({
      name: read_downcity_string(item.name) || derive_downtown_name(downtown_url),
      downtown_url,
    });
  }
  const sessions: Record<string, DowntownUserSession> = {};
  const input_sessions = value?.sessions && typeof value.sessions === "object"
    ? value.sessions
    : {};
  for (const [key, session] of Object.entries(input_sessions)) {
    const downtown_url = normalize_downtown_url(read_downcity_string(session?.downtown_url) || key);
    const user_token = read_downcity_string(session?.user_token);
    if (
      !downtown_url
      || !user_token
    ) continue;
    sessions[downtown_url] = {
      downtown_url,
      user_id: read_downcity_string(session?.user_id) || undefined,
      user_label: read_downcity_string(session?.user_label) || undefined,
      user_token,
      session_id: read_downcity_string(session?.session_id) || undefined,
      updated_at: read_downcity_string(session?.updated_at) || new Date().toISOString(),
    };
  }
  return {
    selected_downtown_url: selected_downtown_url || undefined,
    cli_locale: normalize_cli_locale(value?.cli_locale),
    profiles,
    sessions,
  };
}

function normalize_cli_locale(value: unknown): CliLocale | undefined {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "zh") return "zh";
  if (raw === "en") return "en";
  return undefined;
}
