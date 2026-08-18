/**
 * CLI 当前 Embassy 用户会话解析器。
 *
 * 关键点（中文）
 * - 这是 CLI 和 Agent 宿主访问 Federation 用户能力的唯一身份入口。
 * - env 覆盖优先级、本地 Embassy Session 回退和 Token 实际用户校验都集中在这里。
 * - 业务模块只消费解析后的身份，避免余额、Agent、模型目录各自拼接身份。
 */

import { Embassy, type EmbassyUser } from "@downcity/federation";
import {
  DEFAULT_FEDERATION_URL,
  DEFAULT_BUREAU_ID,
  normalize_federation_url,
  read_federation_admin_session_for_url,
  read_current_embassy_session,
  read_embassy_session_for_federation,
} from "@/city/shared/DowncityConfigStore.js";
import type {
  ResolvedEmbassyUser,
  ResolveEmbassyUserInput,
  EmbassyUserEnvOverrides,
} from "@/city/types/EmbassyUser.js";

/**
 * CLI 当前 Embassy 用户会话解析器。
 */
export class EmbassySessionResolver {
  /**
   * 解析当前有效 Federation 用户。
   */
  async resolve_current_user(input: ResolveEmbassyUserInput = {}): Promise<ResolvedEmbassyUser> {
    const env = input.env ?? process.env;
    const allow_env_override = input.allow_env_override !== false;
    const require_user_token = input.require_user_token !== false;
    const verify_user = input.verify_user !== false;
    const env_federation_url = allow_env_override
      ? read_first_env(env, ["DOWNCITY_FEDERATION_URL"])
      : "";
    const env_user_token = allow_env_override
      ? read_first_env(env, ["DOWNCITY_USER_TOKEN"])
      : "";
    const selected_session = read_current_embassy_session();
    const federation_url = normalize_federation_url(env_federation_url || selected_session?.federation_url || DEFAULT_FEDERATION_URL);
    const session = env_user_token
      ? selected_session
      : read_embassy_session_for_federation(federation_url);

    const env_overrides: EmbassyUserEnvOverrides = {
      federation_url: Boolean(env_federation_url),
      user_token: Boolean(env_user_token),
    };
    const bureau_id = session?.bureau_id ?? DEFAULT_BUREAU_ID;
    const user_token = env_user_token || session?.user_token || "";
    const source = env_user_token ? "env" : "embassy-session";
    const warnings: string[] = [];

    if (!federation_url) {
      throw new Error("Federation URL is required. Run `city federation use` or set DOWNCITY_FEDERATION_URL.");
    }
    if (require_user_token && !user_token) {
      throw new Error("Federation user token is required. Run `city federation login` first.");
    }
    if (env_user_token && selected_session?.user_id) {
      warnings.push("DOWNCITY_USER_TOKEN overrides the saved Embassy session.");
    }
    if (env_federation_url && !env_user_token && !session?.user_token) {
      warnings.push("DOWNCITY_FEDERATION_URL selected a Federation without a saved user session.");
    }

    const resolved: ResolvedEmbassyUser = {
      federation_url,
      bureau_id,
      user_token,
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
   * 创建当前有效 Embassy user 子域。
   */
  async create_user_client(input: ResolveEmbassyUserInput = {}): Promise<{
    /**
     * 当前有效身份。
     */
    user: ResolvedEmbassyUser;

    /**
     * 绑定当前用户身份的 Federation 用户访问器。
     */
    embassy_user: EmbassyUser;

    /** 绑定当前用户身份的完整 Embassy 客户端。 */
    embassy: Embassy;
  }> {
    const user = await this.resolve_current_user({
      ...input,
      require_user_token: input.require_user_token !== false,
    });
    if (!user.user_token) {
      throw new Error("Federation user token is required. Run `city federation login` first.");
    }
    const embassy = new Embassy({
      federation_url: user.federation_url,
      user_token: user.user_token,
    });
    return {
      user,
      embassy,
      embassy_user: embassy.user,
    };
  }

  /** 读取 `fed` 为当前 Federation 保存的有效管理员 Session。 */
  read_admin_session(federation_url: string): string | undefined {
    return read_federation_admin_session_for_url(federation_url);
  }

  private async verify_current_user(
    user: ResolvedEmbassyUser,
    session_user_id?: string,
  ): Promise<ResolvedEmbassyUser> {
    const embassy = new Embassy({
      federation_url: user.federation_url,
      user_token: user.user_token,
    });
    const result = await embassy.user.current();
    const token_user_id = read_string(result.user.user_id);
    const token_bureau_id = typeof result.user.bureau_id === "string"
      ? result.user.bureau_id
      : "";
    if (!token_user_id) {
      throw new Error("Federation user token resolved without a user_id. Run `city federation login` again.");
    }
    if (!token_bureau_id) {
      throw new Error("Federation user token resolved without a bureau_id. Run `city federation login` again.");
    }
    if (session_user_id && !user.env_overrides.user_token && session_user_id !== token_user_id) {
      throw new Error([
        "Embassy session user does not match the authenticated token.",
        `session=${session_user_id}`,
        `token=${token_user_id}`,
        "Run `city federation logout` and then `city federation login`.",
      ].join(" "));
    }

    const email = read_string(result.profile?.email);
    const display_name = read_string(result.profile?.display_name);
    return {
      ...user,
      bureau_id: token_bureau_id,
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
