/**
 * City 本地状态存储。
 *
 * 关键点（中文）
 * - 只负责读取/写入 City 自己保存的 Federation 与 user session。
 * - 同时提供只读发现 `downfed` admin Federation 配置的能力。
 * - 不包含交互菜单、输出渲染或用户身份校验逻辑。
 */

import {
  createCityPlatformStore,
  createFederationPlatformStore,
} from "@/city/runtime/store/index.js";
import type { FederationProfile } from "@/city/types/FederationMembership.js";
import type { CityUserSession } from "@/city/types/CitySession.js";
import type { CliLocale } from "@/shared/types/CliLocale.js";
import type {
  CityAdminConfig,
  CityLocalProfile,
  CityLocalState,
} from "@/city/types/CityState.js";

/** 默认 Federation 地址。 */
export const DEFAULT_FEDERATION_URL = "https://base.downcity.ai";

/** 默认产品身份；仅作为 CLI 的显式预配置 Bureau。 */
export const DEFAULT_BUREAU_ID = "downcity";

const CITY_STATE_KEY = "city.city.state";
const FEDERATION_CONFIG_KEY = "federation.config";

/**
 * 读取字符串字段。
 */
export function readCityString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 规范化 Federation URL。
 */
export function normalizeCityUrl(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const has_protocol = /^[a-z][a-z\d+.-]*:///iu.test(raw);
  const with_protocol = has_protocol ? raw : `${defaultProtocol(raw)}://${raw}`;
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
 * 读取 City 本地状态。
 */
export function readCityState(): CityLocalState {
  const store = createCityPlatformStore();
  try {
    return normalizeLocalState(
      store.getSecureSettingJsonSync<CityLocalState>(CITY_STATE_KEY),
    );
  } finally {
    store.close();
  }
}

/**
 * 写入 City 本地状态。
 */
export function writeCityState(state: CityLocalState): void {
  const store = createCityPlatformStore();
  try {
    store.setSecureSettingJsonSync(CITY_STATE_KEY, normalizeLocalState(state));
  } finally {
    store.close();
  }
}

/**
 * 读取 City 持久化的 CLI 语言。
 */
export function readPersistedCityCliLocale(): CliLocale | undefined {
  return readCityState().cli_locale;
}

/**
 * 写入 City 持久化的 CLI 语言。
 */
export function writePersistedCityCliLocale(cli_locale: CliLocale): void {
  const state = readCityState();
  writeCityState({
    ...state,
    cli_locale,
  });
}

/**
 * 读取当前选中的 Federation URL。
 */
export function resolve_selected_federation_url(state: CityLocalState = readCityState()): string {
  return normalizeCityUrl(readCityString(state.selected_federation_url)) || DEFAULT_FEDERATION_URL;
}

/**
 * 读取当前选中 Federation 的 user session。
 */
export function read_current_city_session(): CityUserSession | null {
  const state = readCityState();
  const federation_url = resolve_selected_federation_url(state);
  return state.sessions?.[federation_url] ?? null;
}

/**
 * 读取指定 Federation 的 user session。
 */
export function read_city_session_for_federation(federation_url: string): CityUserSession | null {
  const state = readCityState();
  const normalized_url = normalizeCityUrl(federation_url);
  if (!normalized_url) return null;
  return state.sessions?.[normalized_url] ?? null;
}

/**
 * 添加或更新 City 本地 Federation 配置。
 */
export function upsert_federation_profile(state: CityLocalState, input: {
  /**
   * Federation URL。
   */
  federation_url: string;

  /**
   * 可选展示名。
   */
  name?: string;
}): CityLocalState {
  const federation_url = normalizeCityUrl(input.federation_url);
  if (!federation_url) return state;
  const profiles = [...(state.profiles ?? [])];
  const index = profiles.findIndex((item) => item.federation_url === federation_url);
  const profile = {
    name: readCityString(input.name) || derive_federation_name(federation_url),
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
 * 列出 City 可选择的 Federation。
 *
 * 说明（中文）
 * - 这里只返回 City 本地保存或 `downfed` admin 保存过的 Federation。
 * - 默认 Federation 只作为未选择时的运行期 fallback，不再作为“已配置项”展示。
 */
export function list_federations(): FederationProfile[] {
  const state = readCityState();
  const selected_url = resolve_selected_federation_url(state);
  const admin_servers = read_city_admin_federations();
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
      source: existing.source === "city" ? "city" : profile.source,
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
      source: "city",
      has_admin_session: Boolean(read_city_admin_session_for_url(profile.federation_url)),
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
export function read_city_admin_session_for_url(federation_url: string): string | undefined {
  const target_url = normalizeCityUrl(federation_url);
  const raw = readCityAdminConfig();
  const servers = Array.isArray(raw.servers) ? raw.servers : [];
  const matched = servers.find((item) =>
    normalizeCityUrl(readCityString(item.base_url)) === target_url,
  );
  const expires_at = readCityString(matched?.admin_session_expires_at);
  if (!expires_at || Date.parse(expires_at) <= Date.now()) return undefined;
  return readCityString(matched?.admin_session_token) || undefined;
}

function defaultProtocol(value: string): "http" | "https" {
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

function readCityAdminConfig(): CityAdminConfig {
  const store = createFederationPlatformStore();
  try {
    const config = store.getSecureSettingJsonSync<CityAdminConfig>(FEDERATION_CONFIG_KEY);
    return config ?? {};
  } finally {
    store.close();
  }
}

function read_city_admin_federations(): FederationProfile[] {
  const raw = readCityAdminConfig();
  const servers = Array.isArray(raw.servers) ? raw.servers : [];
  const active_url = normalizeCityUrl(readCityString(raw.active_server_url));
  const out: FederationProfile[] = [];
  const state = readCityState();
  const selected_url = resolve_selected_federation_url(state);

  for (const item of servers) {
    const federation_url = normalizeCityUrl(readCityString(item.base_url));
    if (!federation_url || out.some((server) => server.federation_url === federation_url)) continue;
    const session = state.sessions?.[federation_url];
    out.push({
      name: readCityString(item.name) || derive_federation_name(federation_url),
      federation_url,
      selected: federation_url === selected_url,
      source: "city-admin",
      has_admin_session: Boolean(
        readCityString(item.admin_session_token)
        && Date.parse(readCityString(item.admin_session_expires_at)) > Date.now(),
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

function normalizeLocalState(value: CityLocalState | null | undefined): CityLocalState {
  const selected_federation_url = normalizeCityUrl(readCityString(value?.selected_federation_url));
  const profiles: CityLocalProfile[] = [];
  for (const item of Array.isArray(value?.profiles) ? value.profiles : []) {
    const federation_url = normalizeCityUrl(readCityString(item.federation_url));
    if (!federation_url || profiles.some((profile) => profile.federation_url === federation_url)) continue;
    profiles.push({
      name: readCityString(item.name) || derive_federation_name(federation_url),
      federation_url,
    });
  }
  const sessions: Record<string, CityUserSession> = {};
  const input_sessions = value?.sessions && typeof value.sessions === "object"
    ? value.sessions
    : {};
  for (const [key, session] of Object.entries(input_sessions)) {
    const federation_url = normalizeCityUrl(readCityString(session?.federation_url) || key);
    const bureau_id = session?.bureau_id;
    const user_token = readCityString(session?.user_token);
    if (
      !federation_url
      || typeof bureau_id !== "string"
      || bureau_id.length === 0
      || !user_token
    ) continue;
    sessions[federation_url] = {
      federation_url,
      bureau_id,
      user_id: readCityString(session?.user_id) || undefined,
      user_label: readCityString(session?.user_label) || undefined,
      user_token,
      updated_at: readCityString(session?.updated_at) || new Date().toISOString(),
    };
  }
  return {
    selected_federation_url: selected_federation_url || undefined,
    cli_locale: normalizeCliLocale(value?.cli_locale),
    profiles,
    sessions,
  };
}

function normalizeCliLocale(value: unknown): CliLocale | undefined {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "zh") return "zh";
  if (raw === "en") return "en";
  return undefined;
}
