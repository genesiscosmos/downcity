/**
 * City 与 Downtown 成员资格管理服务。
 *
 * 关键点（中文）
 * - `city` CLI 作为本机 City 容器，通过 Downtown 访问共享资源。
 * - 本模块维护 City 加入的 Downtown、登录态与本地 profile。
 * - City 只读发现 `downtown` admin 配置的 Downtown，但不依赖其内部模块。
 * - CLI 命令装配统一放在 `src/command/DowntownCommand.ts`，本模块只保留状态与登录流程。
 */

import { revoke_saved_user_session } from "./DowntownUserCredentials.js";
import { emitCliBlock, emitCliList } from "@/shared/CliReporter.js";
import { printResult } from "@/city/utils/cli/CliOutput.js";
import { perform_downtown_user_login } from "@/city/shared/DowntownUserLogin.js";
import { open_city_manager_tui } from "@/city/tui/DowntownManagerTui.js";
import prompts from "@/city/tui/Prompts.js";
import { DowntownSessionResolver } from "@/city/shared/DowntownSessionResolver.js";
import type {
  DowntownMembershipState,
  DowntownProfile,
} from "@/city/types/DowntownMembership.js";
import type { DowntownUserSession } from "@/city/types/DowntownSession.js";
import {
  DEFAULT_DOWNTOWN_URL,
  list_downtowns,
  normalize_downtown_url,
  read_downtown_admin_session_for_url,
  read_downcity_config,
  resolve_selected_downtown_url,
  upsert_downtown_profile,
  write_downcity_config,
} from "@/city/shared/DowncityConfigStore.js";
const downtown_session_resolver = new DowntownSessionResolver();

export function read_city_admin_session_for_downtown(downtown_url: string): string | undefined {
  return read_downtown_admin_session_for_url(downtown_url);
}

function find_downtown(input?: string): DowntownProfile | null {
  const query = String(input || "").trim();
  const servers = list_downtowns();
  if (!query) return servers.find((server) => server.selected) ?? servers[0] ?? null;
  const normalized_query_url = normalize_downtown_url(query);
  return servers.find((server) =>
    server.name === query ||
    server.downtown_url === normalized_query_url ||
    server.downtown_url === query,
  ) ?? null;
}

export function read_downtown_membership_state(): DowntownMembershipState {
  const state = read_downcity_config();
  const downtown_url = resolve_selected_downtown_url(state);
  const session = state.sessions?.[downtown_url] ?? null;
  if (session?.user_token) {
    return {
      downtown_url,
      has_user_token: true,
      source: "downtown-session",
      user_id: session.user_id,
      user_label: session.user_label,
    };
  }

  const server = list_downtowns().find((item) => item.downtown_url === downtown_url);
  return {
    downtown_url,
    has_user_token: false,
    source: server?.source === "downtown-admin"
      ? "downtown-admin"
      : server?.source === "downcity-profile"
        ? "downcity-profile"
        : "default",
  };
}

export function emit_downtown_status(options?: { as_json?: boolean }): void {
  const state = read_downtown_membership_state();
  if (options?.as_json === true) {
    printResult({
      type: "block",
      asJson: true,
      success: state.source !== "missing",
      title: "downtown membership",
      data: {
        connection: state,
        downtowns: list_downtowns(),
      },
    });
    return;
  }

  emitCliBlock({
    tone: state.has_user_token ? "success" : "warning",
    title: "Downtown membership",
    summary: state.has_user_token ? "signed in" : "downtown selected",
    facts: [
      { label: "url", value: state.downtown_url },
      { label: "user token", value: state.has_user_token ? "configured" : "missing" },
      { label: "source", value: state.source },
      ...(state.user_id ? [{ label: "user", value: state.user_id }] : []),
    ],
    note: state.has_user_token
      ? undefined
      : "Run `city towns login <url>` to sign in."
  });
}

export async function emitCityUserWhoami(options?: { as_json?: boolean }): Promise<void> {
  try {
    const user = await downtown_session_resolver.resolve_current_user();
    if (options?.as_json === true) {
      printResult({
        type: "block",
        asJson: true,
        success: true,
        title: "city user",
        data: {
          downtown_url: user.downtown_url,
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
        { label: "url", value: user.downtown_url },
        { label: "user", value: user.user_id || "unknown" },
        ...(user.user_label ? [{ label: "label", value: user.user_label }] : []),
        { label: "source", value: user.source },
        { label: "env url", value: user.env_overrides.downtown_url ? "yes" : "no" },
        { label: "env token", value: user.env_overrides.user_token ? "yes" : "no" },
      ],
      note: user.warnings.join(" ") || undefined,
    });
  } catch (error) {
    if (options?.as_json === true) {
      printResult({
        type: "block",
        asJson: true,
        success: false,
        title: "city user",
        data: {
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

export function emit_downtown_list(options?: { as_json?: boolean }): void {
  const servers = list_downtowns();
  if (options?.as_json === true) {
    printResult({
      type: "block",
      asJson: true,
      success: true,
      title: "downtowns",
      data: {
        count: servers.length,
        downtowns: servers,
      },
    });
    return;
  }

  emitCliList({
    tone: "accent",
    title: "Downtowns",
    summary: `${servers.length} available`,
    items: servers.map((server) => ({
      tone: server.selected ? "success" : "info",
      title: server.name,
      facts: [
        { label: "url", value: server.downtown_url },
        { label: "selected", value: server.selected ? "yes" : "no" },
        { label: "source", value: server.source },
        { label: "user session", value: server.has_user_session ? "yes" : "no" },
        { label: "admin profile", value: server.has_admin_session ? "yes" : "no" },
      ],
    })),
  });
}

export async function run_downtown_join_command(params: {
  url?: string;
  as_json?: boolean;
}): Promise<void> {
  let downtown_url = normalize_downtown_url(String(params.url || ""));

  if (!downtown_url && process.stdin.isTTY && process.stdout.isTTY) {
    const response = (await prompts({
      type: "text",
      name: "downtown_url",
      message: "Downtown URL",
      initial: DEFAULT_DOWNTOWN_URL,
    })) as { downtown_url?: string };
    downtown_url = normalize_downtown_url(String(response.downtown_url || ""));
  }

  if (!downtown_url) downtown_url = DEFAULT_DOWNTOWN_URL;

  const state = upsert_downtown_profile(read_downcity_config(), { downtown_url });
  write_downcity_config(state);

  printResult({
    type: "block",
    asJson: params.as_json === true,
    success: true,
    title: "downtown joined",
    data: {
      downtown_url,
      fix: "Run `city towns login <url>` to sign in as a user.",
    },
  });
}

export async function run_downtown_use_command(params: {
  server?: string;
  as_json?: boolean;
}): Promise<void> {
  const server = find_downtown(params.server);
  if (!server) {
    printResult({
      type: "block",
      asJson: params.as_json === true,
      success: false,
      title: "city use failed",
      data: {
        error: "No downtown matched the input",
        fix: "Run `city towns list` to inspect available downtowns.",
      },
    });
    return;
  }

  const state = upsert_downtown_profile(read_downcity_config(), {
    downtown_url: server.downtown_url,
    name: server.name,
  });
  write_downcity_config(state);

  printResult({
    type: "block",
    asJson: params.as_json === true,
    success: true,
    title: "downtown selected",
    data: {
      downtown_url: server.downtown_url,
      source: server.source,
      has_user_session: server.has_user_session,
      fix: server.has_user_session ? undefined : "Run `city towns login <url>` to sign in as a user.",
    },
  });
}

function save_downtown_user_session(session: DowntownUserSession): void {
  const state = upsert_downtown_profile(read_downcity_config(), {
    downtown_url: session.downtown_url,
  });
  const sessions = {
    ...(state.sessions ?? {}),
    [session.downtown_url]: session,
  };
  write_downcity_config({
    ...state,
    selected_downtown_url: session.downtown_url,
    sessions,
  });
}

export async function run_downtown_login_command(params: {
  url?: string;
  as_json?: boolean;
}): Promise<void> {
  if (params.url) {
    const downtown_url = normalize_downtown_url(params.url);
    if (downtown_url) {
      write_downcity_config(upsert_downtown_profile(read_downcity_config(), { downtown_url }));
    }
  }
  const state = read_downcity_config();
  const downtown_url = resolve_selected_downtown_url(state);
  const session = await perform_downtown_user_login({
    downtown_url,
  });
  if (!session) {
    printResult({
      type: "block",
      asJson: params.as_json === true,
      success: false,
      title: "downtown login cancelled",
      data: { downtown_url },
    });
    return;
  }

  save_downtown_user_session(session);
  printResult({
    type: "block",
    asJson: params.as_json === true,
    success: true,
    title: "downtown user signed in",
    data: {
      downtown_url: session.downtown_url,
      user_id: session.user_id,
      user_label: session.user_label,
    },
  });
}

export async function run_downtown_logout_command(options?: { as_json?: boolean }): Promise<void> {
  const state = read_downcity_config();
  const downtown_url = resolve_selected_downtown_url(state);
  const sessions = { ...(state.sessions ?? {}) };
  const session = sessions[downtown_url];
  const revoked = await revoke_saved_user_session(downtown_url, session?.session_id, session?.user_token);
  const current = read_downcity_config();
  const current_session = current.sessions?.[downtown_url];
  if (current_session?.user_token === session?.user_token && current_session?.session_id === session?.session_id) {
    const next_sessions = { ...current.sessions };
    delete next_sessions[downtown_url];
    write_downcity_config({ ...current, sessions: next_sessions });
  }
  printResult({
    type: "block",
    asJson: options?.as_json === true,
    success: true,
    title: revoked ? "downtown user signed out" : "signed out locally; remote revocation unavailable",
    data: {
      downtown_url,
    },
  });
}

export function run_downtown_leave_command(options?: { as_json?: boolean }): void {
  const state = read_downcity_config();
  const downtown_url = resolve_selected_downtown_url(state);
  const profiles = (state.profiles ?? []).filter((profile) => profile.downtown_url !== downtown_url);
  const sessions = { ...(state.sessions ?? {}) };
  delete sessions[downtown_url];
  write_downcity_config({
    ...state,
    selected_downtown_url: undefined,
    profiles,
    sessions,
  });
  printResult({
    type: "block",
    asJson: options?.as_json === true,
    success: true,
    title: "downtown left",
    data: {
      left: downtown_url,
      selected: undefined,
    },
  });
}

export async function run_interactive_downtown_manager(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  await open_city_manager_tui();
}
