/**
 * Downcity 本地配置存储。
 *
 * 关键点（中文）
 * - 只负责读取/写入 Downcity 保存的 Federation 与 Embassy Session。
 * - 用户配置与 `fed` 管理端配置共用 `downcity.db`，但使用独立配置 key。
 * - 不包含交互菜单、输出渲染或用户身份校验逻辑。
 */

import {
  create_downcity_platform_store,
  create_federation_platform_store,
} from "@/city/runtime/store/index.js";
import type { FederationProfile } from "@/city/types/FederationMembership.js";
import type { EmbassyUserSession } from "@/city/types/EmbassySession.js";
import type { CliLocale } from "@/shared/types/CliLocale.js";
import type {
  FederationAdminConfig,
  DowncityFederationProfile,
  DowncityConfig,
} from "@/city/types/DowncityConfig.js";

/** 默认 Federation 地址。 */
export const DEFAULT_FEDERATION_URL = "https://base.downcity.ai";

/** 默认产品身份；仅作为 CLI 的显式预配置 Bureau。 */
export const DEFAULT_BUREAU_ID = "downcity";

const DOWNCITY_CONFIG_KEY = "downcity.config";
const LEGACY_CITY_STATE_KEY = "city.city.state";
const FEDERATION_CONFIG_KEY = "federation.config";

/**
 * 读取字符串字段。
 */
export function read_downcity_string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 规范化 Federation URL。
 */
export function normalize_federation_url(value: string): string {
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
 * 读取 Downcity 本地配置，并按需迁移旧 `city.city.state` key。
 */
export function read_downcity_config(): DowncityConfig {
  const store = create_downcity_platform_store();
  try {
    const current = store.getSecureSettingJsonSync<DowncityConfig>(DOWNCITY_CONFIG_KEY);
    if (current) return normalize_downcity_config(current);
    const legacy = store.getSecureSettingJsonSync<DowncityConfig>(LEGACY_CITY_STATE_KEY);
    const migrated = normalize_downcity_config(legacy);
    store.setSecureSettingJsonSync(DOWNCITY_CONFIG_KEY, migrated);
    return migrated;
  } finally {
    store.close();
  }
}

/**
 * 写入 Downcity 本地配置。
 */
export function write_downcity_config(state: DowncityConfig): void {
  const store = create_downcity_platform_store();
  try {
    store.setSecureSettingJsonSync(DOWNCITY_CONFIG_KEY, normalize_downcity_config(state));
  } finally {
    store.close();
  }
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
 * 读取当前选中的 Federation URL。
 */
export function resolve_selected_federation_url(state: DowncityConfig = read_downcity_config()): string {
  return normalize_federation_url(read_downcity_string(state.selected_federation_url)) || DEFAULT_FEDERATION_URL;
}

/**
 * 读取当前选中 Federation 的 user session。
 */
export function read_current_embassy_session(): EmbassyUserSession | null {
  const state = read_downcity_config();
  const federation_url = resolve_selected_federation_url(state);
  return state.sessions?.[federation_url] ?? null;
}

/**
 * 读取指定 Federation 的 user session。
 */
export function read_embassy_session_for_federation(federation_url: string): EmbassyUserSession | null {
  const state = read_downcity_config();
  const normalized_url = normalize_federation_url(federation_url);
  if (!normalized_url) return null;
  return state.sessions?.[normalized_url] ?? null;
}

/**
 * 添加或更新 Downcity 本地 Federation 配置。
 */
export function upsert_federation_profile(state: DowncityConfig, input: {
  /**
   * Federation URL。
   */
  federation_url: string;

  /**
   * 可选展示名。
   */
  name?: string;
}): DowncityConfig {
  const federation_url = normalize_federation_url(input.federation_url);
  if (!federation_url) return state;
  const profiles = [...(state.profiles ?? [])];
  const index = profiles.findIndex((item) => item.federation_url === federation_url);
  const profile = {
    name: read_downcity_string(input.name) || derive_federation_name(federation_url),
    federation_url,
  };
  if (index >= 0) profiles[index] = profile;
  else profiles.push(profile);
  return {
    ...state,
    selected_federation_url: federation_url,
    profiles,
  };
}

/**
 * 列出 Downcity 可选择的 Federation。
 *
 * 说明（中文）
 * - 这里只返回 Downcity 本地保存或 `fed` admin 保存过的 Federation。
 * - 默认 Federation 只作为未选择时的运行期 fallback，不再作为“已配置项”展示。
 */
export function list_federations(): FederationProfile[] {
  const state = read_downcity_config();
  const selected_url = resolve_selected_federation_url(state);
  const admin_servers = read_federation_admin_profiles();
  const by_url = new Map<string, FederationProfile>();

  const append = (profile: FederationProfile): void => {
    const existing = by_url.get(profile.federation_url);
    if (!existing) {
      by_url.set(profile.federation_url, profile);
      return;
    }
    by_url.set(profile.federation_url, {
      ...existing,
      selected: existing.selected || profile.selected,
      source: existing.source === "downcity-profile" ? "downcity-profile" : profile.source,
      has_admin_session: existing.has_admin_session || profile.has_admin_session,
      has_user_session: existing.has_user_session || profile.has_user_session,
      bureau_id: existing.bureau_id || profile.bureau_id,
      user_id: existing.user_id || profile.user_id,
    });
  };

  for (const profile of state.profiles ?? []) {
    const session = state.sessions?.[profile.federation_url];
    append({
      name: profile.name,
      federation_url: profile.federation_url,
      selected: profile.federation_url === selected_url,
      source: "downcity-profile",
      has_admin_session: Boolean(read_federation_admin_session_for_url(profile.federation_url)),
      has_user_session: Boolean(session?.user_token),
      bureau_id: session?.bureau_id,
      user_id: session?.user_id,
    });
  }

  for (const server of admin_servers) append(server);

  return [...by_url.values()].sort((left, right) =>
    Number(right.selected) - Number(left.selected)
    || left.name.localeCompare(right.name)
    || left.federation_url.localeCompare(right.federation_url),
  );
}

/**
 * 读取指定 Federation 尚未到期的管理员 Session Token。
 */
export function read_federation_admin_session_for_url(federation_url: string): string | undefined {
  const target_url = normalize_federation_url(federation_url);
  const raw = read_federation_admin_config();
  const servers = Array.isArray(raw.servers) ? raw.servers : [];
  const matched = servers.find((item) =>
    normalize_federation_url(read_downcity_string(item.base_url)) === target_url,
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
 * 从 Federation URL 推导展示名称。
 */
function derive_federation_name(federation_url: string): string {
  try {
    return new URL(federation_url).hostname || federation_url;
  } catch {
    return federation_url;
  }
}

function read_federation_admin_config(): FederationAdminConfig {
  const store = create_federation_platform_store();
  try {
    const config = store.getSecureSettingJsonSync<FederationAdminConfig>(FEDERATION_CONFIG_KEY);
    return config ?? {};
  } finally {
    store.close();
  }
}

function read_federation_admin_profiles(): FederationProfile[] {
  const raw = read_federation_admin_config();
  const servers = Array.isArray(raw.servers) ? raw.servers : [];
  const active_url = normalize_federation_url(read_downcity_string(raw.active_server_url));
  const out: FederationProfile[] = [];
  const state = read_downcity_config();
  const selected_url = resolve_selected_federation_url(state);

  for (const item of servers) {
    const federation_url = normalize_federation_url(read_downcity_string(item.base_url));
    if (!federation_url || out.some((server) => server.federation_url === federation_url)) continue;
    const session = state.sessions?.[federation_url];
    out.push({
      name: read_downcity_string(item.name) || derive_federation_name(federation_url),
      federation_url,
      selected: federation_url === selected_url,
      source: "federation-admin",
      has_admin_session: Boolean(
        read_downcity_string(item.admin_session_token)
        && Date.parse(read_downcity_string(item.admin_session_expires_at)) > Date.now(),
      ),
      has_user_session: Boolean(session?.user_token),
      bureau_id: session?.bureau_id,
      user_id: session?.user_id,
    });
  }

  return out.sort((left, right) =>
    Number(right.federation_url === active_url) - Number(left.federation_url === active_url)
    || left.name.localeCompare(right.name)
    || left.federation_url.localeCompare(right.federation_url),
  );
}

function normalize_downcity_config(value: DowncityConfig | null | undefined): DowncityConfig {
  const selected_federation_url = normalize_federation_url(read_downcity_string(value?.selected_federation_url));
  const profiles: DowncityFederationProfile[] = [];
  for (const item of Array.isArray(value?.profiles) ? value.profiles : []) {
    const federation_url = normalize_federation_url(read_downcity_string(item.federation_url));
    if (!federation_url || profiles.some((profile) => profile.federation_url === federation_url)) continue;
    profiles.push({
      name: read_downcity_string(item.name) || derive_federation_name(federation_url),
      federation_url,
    });
  }
  const sessions: Record<string, EmbassyUserSession> = {};
  const input_sessions = value?.sessions && typeof value.sessions === "object"
    ? value.sessions
    : {};
  for (const [key, session] of Object.entries(input_sessions)) {
    const federation_url = normalize_federation_url(read_downcity_string(session?.federation_url) || key);
    const bureau_id = session?.bureau_id;
    const user_token = read_downcity_string(session?.user_token);
    if (
      !federation_url
      || typeof bureau_id !== "string"
      || bureau_id.length === 0
      || !user_token
    ) continue;
    sessions[federation_url] = {
      federation_url,
      bureau_id,
      user_id: read_downcity_string(session?.user_id) || undefined,
      user_label: read_downcity_string(session?.user_label) || undefined,
      user_token,
      updated_at: read_downcity_string(session?.updated_at) || new Date().toISOString(),
    };
  }
  return {
    selected_federation_url: selected_federation_url || undefined,
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
