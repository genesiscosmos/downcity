/**
 * City 与 Federation 成员资格管理服务。
 *
 * 关键点（中文）
 * - `city` CLI 作为本机 City 容器，通过 Federation 访问共享资源。
 * - 本模块维护 City 加入的 Federation、登录态与本地 profile。
 * - City 只读发现 `downfed` admin 配置的 Federation，但不依赖其内部模块。
 * - CLI 命令装配统一放在 `src/command/FederationCommand.ts`，本模块只保留状态与登录流程。
 */

import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { performCityUserLogin } from "@/city/shared/CityUserLogin.js";
import { open_city_manager_tui } from "@/city/tui/FederationManagerTui.js";
import prompts from "@/city/tui/Prompts.js";
import { CityUserManager } from "@/city/shared/CityUserManager.js";
import type {
  FederationMembershipState,
  FederationProfile,
} from "@/city/types/FederationMembership.js";
import type { CityUserSession } from "@/city/types/CitySession.js";
import {
  DEFAULT_FEDERATION_URL,
  DEFAULT_BUREAU_ID,
  list_federations,
  normalizeCityUrl,
  read_city_admin_secret_for_url,
  read_city_bureau_id,
 read_current_city_session,
 readCityState,
  resolve_selected_federation_url,
  upsert_federation_profile,
  writeCityState,
} from "@/city/shared/CityStateStore.js";
const cityUserManager = new CityUserManager();

export function read_city_admin_secret_for_federation(federation_url: string): string | undefined {
  return read_city_admin_secret_for_url(federation_url);
}

function find_federation(input?: string): FederationProfile | null {
  const query = String(input || "").trim();
  const servers = list_federations();
  if (!query) return servers.find((server) => server.selected) ?? servers[0] ?? null;
  const normalized_query_url = normalizeCityUrl(query);
  return servers.find((server) =>
    server.name === query ||
    server.federation_url === normalized_query_url ||
    server.federation_url === query,
  ) ?? null;
}

export function read_federation_membership_state(): FederationMembershipState {
  const state = readCityState();
  const federation_url = resolve_selected_federation_url(state);
  const session = state.sessions?.[federation_url] ?? null;
  if (session?.user_token) {
    return {
      federation_url,
      bureau_id: session.bureau_id || DEFAULT_BUREAU_ID,
      has_user_token: true,
      source: "city-session",
      user_id: session.user_id,
      user_label: session.user_label,
    };
  }

  const server = list_federations().find((item) => item.federation_url === federation_url);
  return {
    federation_url,
    bureau_id: DEFAULT_BUREAU_ID,
    has_user_token: false,
    source: server?.source === "city-admin"
      ? "city-admin"
      : server?.source === "city"
        ? "city-base"
        : "default",
  };
}

export function emit_federation_status(options?: { as_json?: boolean }): void {
  const state = read_federation_membership_state();
  if (options?.as_json === true) {
    printResult({
      asJson: true,
      success: state.source !== "missing",
      title: "federation membership",
      payload: {
        connection: state,
        federations: list_federations(),
      },
    });
    return;
  }

  emitCliBlock({
    tone: state.has_user_token ? "success" : "warning",
    title: "Federation membership",
    summary: state.has_user_token ? "signed in" : "federation selected",
    facts: [
      { label: "url", value: state.federation_url },
      { label: "city", value: state.bureau_id },
      { label: "user token", value: state.has_user_token ? "configured" : "missing" },
      { label: "source", value: state.source },
      ...(state.user_id ? [{ label: "user", value: state.user_id }] : []),
    ],
    note: state.has_user_token
      ? undefined
      : "Run `city federation login` to sign in."
  });
}

export async function emitCityUserWhoami(options?: { as_json?: boolean }): Promise<void> {
  try {
    const user = await cityUserManager.resolveCurrentUser();
    if (options?.as_json === true) {
      printResult({
        asJson: true,
        success: true,
        title: "city user",
        payload: {
          federation_url: user.federation_url,
          bureau_id: user.bureau_id,
          user_id: user.user_id,
          user_label: user.user_label,
          source: user.source,
          env_overrides: user.env_overrides,
          warnings: user.warnings,
        },
      });
      return;
    }

    emitCliBlock({
      tone: "success",
      title: "City account",
      summary: user.source,
      facts: [
        { label: "url", value: user.federation_url },
        { label: "city", value: user.bureau_id },
        { label: "user", value: user.user_id || "unknown" },
        ...(user.user_label ? [{ label: "label", value: user.user_label }] : []),
        { label: "source", value: user.source },
        { label: "env url", value: user.env_overrides.federation_url ? "yes" : "no" },
        { label: "env city", value: user.env_overrides.bureau_id ? "yes" : "no" },
        { label: "env token", value: user.env_overrides.user_token ? "yes" : "no" },
      ],
      note: user.warnings.join(" ") || undefined,
    });
  } catch (error) {
    if (options?.as_json === true) {
      printResult({
        asJson: true,
        success: false,
        title: "city user",
        payload: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return;
    }
    emitCliBlock({
      tone: "error",
      title: "City account unavailable",
      note: error instanceof Error ? error.message : String(error),
    });
  }
}

export function emit_federation_list(options?: { as_json?: boolean }): void {
  const servers = list_federations();
  if (options?.as_json === true) {
    printResult({
      asJson: true,
      success: true,
      title: "federations",
      payload: {
        count: servers.length,
        federations: servers,
      },
    });
    return;
  }

  emitCliList({
    tone: "accent",
    title: "Federations",
    summary: `${servers.length} available`,
    items: servers.map((server) => ({
      tone: server.selected ? "success" : "info",
      title: server.name,
      facts: [
        { label: "url", value: server.federation_url },
        { label: "selected", value: server.selected ? "yes" : "no" },
        { label: "source", value: server.source },
        { label: "user session", value: server.has_user_session ? "yes" : "no" },
        { label: "admin profile", value: server.has_admin_secret_key ? "yes" : "no" },
      ],
    })),
  });
}

export async function run_federation_join_command(params: {
  url?: string;
  as_json?: boolean;
}): Promise<void> {
  let federation_url = normalizeCityUrl(String(params.url || ""));

  if (!federation_url && process.stdin.isTTY && process.stdout.isTTY) {
    const response = (await prompts({
      type: "text",
      name: "federation_url",
      message: "Federation URL",
      initial: DEFAULT_FEDERATION_URL,
    })) as { federation_url?: string };
    federation_url = normalizeCityUrl(String(response.federation_url || ""));
  }

  if (!federation_url) federation_url = DEFAULT_FEDERATION_URL;

  const state = upsert_federation_profile(readCityState(), { federation_url });
  writeCityState(state);

  printResult({
    asJson: params.as_json === true,
    success: true,
    title: "federation joined",
    payload: {
      federation_url,
      fix: "Run `city federation login` to sign in as a user.",
    },
  });
}

export async function run_federation_use_command(params: {
  server?: string;
  as_json?: boolean;
}): Promise<void> {
  const server = find_federation(params.server);
  if (!server) {
    printResult({
      asJson: params.as_json === true,
      success: false,
      title: "city use failed",
      payload: {
        error: "No federation matched the input",
        fix: "Run `city federation list` to inspect available federations.",
      },
    });
    return;
  }

  const state = upsert_federation_profile(readCityState(), {
    federation_url: server.federation_url,
    name: server.name,
  });
  writeCityState(state);

  printResult({
    asJson: params.as_json === true,
    success: true,
    title: "federation selected",
    payload: {
      federation_url: server.federation_url,
      source: server.source,
      has_user_session: server.has_user_session,
      fix: server.has_user_session ? undefined : "Run `city federation login` to sign in as a user.",
    },
  });
}

function save_federation_user_session(session: CityUserSession): void {
  const state = upsert_federation_profile(readCityState(), {
    federation_url: session.federation_url,
  });
  const sessions = {
    ...(state.sessions ?? {}),
    [session.federation_url]: session,
  };
  writeCityState({
    ...state,
    selected_federation_url: session.federation_url,
    sessions,
  });
}

export async function run_federation_login_command(params: {
  url?: string;
  bureau_id?: string;
  as_json?: boolean;
}): Promise<void> {
  if (params.url) {
    const federation_url = normalizeCityUrl(params.url);
    if (federation_url) {
      writeCityState(upsert_federation_profile(readCityState(), { federation_url }));
    }
  }
  const state = readCityState();
  const federation_url = resolve_selected_federation_url(state);
  const bureau_id = read_city_bureau_id(params.bureau_id)
    || read_current_city_session()?.bureau_id
    || DEFAULT_BUREAU_ID;
  const session = await performCityUserLogin({
    federation_url,
    bureau_id,
  });
  if (!session) {
    printResult({
      asJson: params.as_json === true,
      success: false,
      title: "federation login cancelled",
      payload: { federation_url },
    });
    return;
  }

  save_federation_user_session(session);
  printResult({
    asJson: params.as_json === true,
    success: true,
    title: "federation user signed in",
    payload: {
      federation_url: session.federation_url,
      bureau_id: session.bureau_id,
      user_id: session.user_id,
      user_label: session.user_label,
    },
  });
}

export function run_federation_logout_command(options?: { as_json?: boolean }): void {
  const state = readCityState();
  const federation_url = resolve_selected_federation_url(state);
  const sessions = { ...(state.sessions ?? {}) };
  delete sessions[federation_url];
  writeCityState({
    ...state,
    sessions,
  });
  printResult({
    asJson: options?.as_json === true,
    success: true,
    title: "federation user signed out",
    payload: {
      federation_url,
    },
  });
}

export function run_federation_leave_command(options?: { as_json?: boolean }): void {
  const state = readCityState();
  const federation_url = resolve_selected_federation_url(state);
  const profiles = (state.profiles ?? []).filter((profile) => profile.federation_url !== federation_url);
  const sessions = { ...(state.sessions ?? {}) };
  delete sessions[federation_url];
  writeCityState({
    ...state,
    selected_federation_url: undefined,
    profiles,
    sessions,
  });
  printResult({
    asJson: options?.as_json === true,
    success: true,
    title: "federation left",
    payload: {
      left: federation_url,
      selected: undefined,
    },
  });
}

export async function run_interactive_federation_manager(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  await open_city_manager_tui();
}
