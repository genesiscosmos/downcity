/**
 * CLI 当前 Downtown 用户会话解析器。
 *
 * 关键点（中文）
 * - 这是 CLI 和 Agent 宿主访问 Downtown 用户能力的唯一身份入口。
 * - env 覆盖优先级、本地 Downtown Session 回退和 Token 实际用户校验都集中在这里。
 * - 业务模块只消费解析后的身份，避免余额、Agent、模型目录各自拼接身份。
 */

import { shared_user_token_resolver } from "./DowntownUserCredentials.js";
import { Downtown, type DowntownUser } from "@downcity/downtown";
import {
  DEFAULT_DOWNTOWN_URL,
  normalize_downtown_url,
  read_downtown_admin_session_for_url,
  read_current_downtown_session,
  read_downtown_session_for_downtown,
} from "@/city/shared/DowncityConfigStore.js";
import type {
  ResolvedDowntownUser,
  ResolveDowntownUserInput,
  DowntownUserEnvOverrides,
} from "@/city/types/DowntownUser.js";

/**
 * CLI 当前 Downtown 用户会话解析器。
 */
export class DowntownSessionResolver {
  /**
   * 解析当前有效 Downtown 用户。
   */
  async resolve_current_user(input: ResolveDowntownUserInput = {}): Promise<ResolvedDowntownUser> {
    const env = input.env ?? process.env;
    const allow_env_override = input.allow_env_override !== false;
    const require_user_token = input.require_user_token !== false;
    const verify_user = input.verify_user !== false;
    const env_downtown_url = allow_env_override
      ? read_first_env(env, ["DOWNCITY_DOWNTOWN_URL"])
      : "";
    const env_user_token = allow_env_override
      ? read_first_env(env, ["DOWNCITY_USER_TOKEN"])
      : "";
    const selected_session = read_current_downtown_session();
    const downtown_url = normalize_downtown_url(env_downtown_url || selected_session?.downtown_url || DEFAULT_DOWNTOWN_URL);
    const session = env_user_token
      ? selected_session
      : read_downtown_session_for_downtown(downtown_url);

    const env_overrides: DowntownUserEnvOverrides = {
      downtown_url: Boolean(env_downtown_url),
      user_token: Boolean(env_user_token),
    };
    const user_token = env_user_token || session?.user_token || "";
    const source = env_user_token ? "env" : "downtown-session";
    const warnings: string[] = [];

    if (!downtown_url) {
      throw new Error("Downtown URL is required. Set DOWNCITY_DOWNTOWN_URL or select a connection with `city towns`.");
    }
    if (require_user_token && !user_token) {
      throw new Error("Downtown user token is required. Run `city towns login <url>` first.");
    }
    if (env_user_token && selected_session?.user_id) {
      warnings.push("DOWNCITY_USER_TOKEN overrides the saved Downtown session.");
    }
    if (env_downtown_url && !env_user_token && !session?.user_token) {
      warnings.push("DOWNCITY_DOWNTOWN_URL selected a Downtown without a saved user session.");
    }

    const resolved: ResolvedDowntownUser = {
      downtown_url,
      user_token,
      session_id: env_user_token ? undefined : session?.session_id,
      user_id: env_user_token ? undefined : session?.user_id,
      user_label: env_user_token ? undefined : session?.user_label,
      source,
      env_overrides,
      warnings,
    };

    if (verify_user && user_token) {
      return await this.verify_current_user(resolved, env_user_token ? undefined : session?.user_id);
    }
    return resolved;
  }

  /**
   * 创建当前有效 Downtown user 子域。
   */
  async create_user_client(input: ResolveDowntownUserInput = {}): Promise<{
    /**
     * 当前有效身份。
     */
    user: ResolvedDowntownUser;

    /**
     * 绑定当前用户身份的 Downtown 用户访问器。
     */
    downtown_user: DowntownUser;

    /** 绑定当前用户身份的完整 Downtown 客户端。 */
    downtown: Downtown;
  }> {
    const user = await this.resolve_current_user({
      ...input,
      require_user_token: false,
      verify_user: false,
    });
    if (!user.user_token) {
      throw new Error("Downtown user token is required. Run `city towns login <url>` first.");
    }
    const downtown = new Downtown({ url: user.downtown_url, user_token: user.user_token, resolve_user_token: shared_user_token_resolver(user.downtown_url, user.session_id) });
    const verified_user = input.verify_user === false ? user : await this.verify_current_user(user, user.user_id, downtown);
    return {
      user: verified_user,
      downtown,
      downtown_user: downtown.user,
    };
  }

  /** 宿主启动时仅从已存身份离线构建绑定；未登录时保持本地运行。 */
  async create_runtime_client(): Promise<Downtown | undefined> {
    const user = await this.resolve_current_user({ require_user_token: false, verify_user: false });
    return user.user_token
      ? new Downtown({ url: user.downtown_url, user_token: user.user_token, resolve_user_token: shared_user_token_resolver(user.downtown_url, user.session_id) })
      : undefined;
  }

  /** 读取 `fed` 为当前 Downtown 保存的有效管理员 Session。 */
  read_admin_session(downtown_url: string): string | undefined {
    return read_downtown_admin_session_for_url(downtown_url);
  }

  private async verify_current_user(
    user: ResolvedDowntownUser,
    session_user_id?: string,
    current?: Downtown,
  ): Promise<ResolvedDowntownUser> {
    const downtown = current ?? new Downtown({
      url: user.downtown_url,
      user_token: user.user_token,
      resolve_user_token: shared_user_token_resolver(user.downtown_url, user.session_id),
    });
    const result = await downtown.user.current();
    const token_user_id = read_string(result.user.user_id);
    if (!token_user_id) {
      throw new Error("Downtown user token resolved without a user_id. Run `city towns login <url>` again.");
    }
    if (session_user_id && !user.env_overrides.user_token && session_user_id !== token_user_id) {
      throw new Error([
        "Downtown session user does not match the authenticated token.",
        `session=${session_user_id}`,
        `token=${token_user_id}`,
        "Run `city towns logout <url>` and then `city towns login <url>`.",
      ].join(" "));
    }

    const email = read_string(result.profile?.email);
    const display_name = read_string(result.profile?.display_name);
    return {
      ...user,
      user_id: token_user_id,
      user_label: email || display_name || token_user_id,
    };
  }
}

function read_string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function read_first_env(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = read_string(env[key]);
    if (value) return value;
  }
  return "";
}
