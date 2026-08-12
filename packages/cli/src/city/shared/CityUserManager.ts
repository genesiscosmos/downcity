/**
 * City 当前 City user 管理器。
 *
 * 关键点（中文）
 * - 这是 City 访问 City 用户态服务的唯一身份入口。
 * - env 覆盖优先级、`city city login` session 回退、token 实际 user 校验都集中在这里。
 * - 业务模块只消费解析后的身份，避免余额、Agent、模型目录各自拼接身份。
 */

import { Embassy, type EmbassyUser } from "@downcity/federation";
import {
  DEFAULT_FEDERATION_URL,
  DEFAULT_BUREAU_ID,
  normalizeCityUrl,
  read_city_admin_session_for_url,
  read_current_city_session,
  read_city_session_for_federation,
} from "@/city/shared/CityStateStore.js";
import type {
  ResolvedCityUser,
  ResolveCityUserInput,
  CityAccountsMeResult,
  CityUserEnvOverrides,
} from "@/city/types/CityUser.js";

/**
 * City 当前 City user 管理器。
 */
export class CityUserManager {
  /**
   * 解析当前有效 City user。
   */
  async resolveCurrentUser(input: ResolveCityUserInput = {}): Promise<ResolvedCityUser> {
    const env = input.env ?? process.env;
    const allow_env_override = input.allow_env_override !== false;
    const require_user_token = input.require_user_token !== false;
    const verify_user = input.verify_user !== false;
    const env_federation_url = allow_env_override
      ? readFirstEnv(env, ["DOWNCITY_CITY_URL", "CITY_URL"])
      : "";
    const env_user_token = allow_env_override
      ? readFirstEnv(env, ["DOWNCITY_CITY_USER_TOKEN", "CITY_USER_TOKEN"])
      : "";
    const selected_session = read_current_city_session();
    const federation_url = normalizeCityUrl(env_federation_url || selected_session?.federation_url || DEFAULT_FEDERATION_URL);
    const session = env_user_token
      ? selected_session
      : read_city_session_for_federation(federation_url);

    const env_overrides: CityUserEnvOverrides = {
      federation_url: Boolean(env_federation_url),
      user_token: Boolean(env_user_token),
    };
    const bureau_id = session?.bureau_id ?? DEFAULT_BUREAU_ID;
    const user_token = env_user_token || session?.user_token || "";
    const source = env_user_token ? "env" : "city-session";
    const warnings: string[] = [];

    if (!federation_url) {
      throw new Error("City URL is required. Run `city federation use` or set DOWNCITY_CITY_URL.");
    }
    if (require_user_token && !user_token) {
      throw new Error("City user token is required. Run `city federation login` first.");
    }
    if (env_user_token && selected_session?.user_id) {
      warnings.push("Env user token overrides the saved `city federation login` session.");
    }
    if (env_federation_url && !env_user_token && !session?.user_token) {
      warnings.push("Env City URL selected a base without a saved Federation user session.");
    }

    const resolved: ResolvedCityUser = {
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
      return await this.verifyCurrentUser(resolved, env_user_token ? undefined : session?.user_id);
    }
    return resolved;
  }

  /**
   * 创建当前有效 Embassy user 子域。
   */
  async createUserClient(input: ResolveCityUserInput = {}): Promise<{
    /**
     * 当前有效身份。
     */
    user: ResolvedCityUser;

    /**
     * 绑定当前用户身份的 Federation 用户访问器。
     */
    embassy_user: EmbassyUser;
  }> {
    const user = await this.resolveCurrentUser({
      ...input,
      require_user_token: input.require_user_token !== false,
    });
    if (!user.user_token) {
      throw new Error("City user token is required. Run `city city login` first.");
    }
    return {
      user,
      embassy_user: new Embassy({
        federation_url: user.federation_url,
        user_token: user.user_token,
      }).user,
    };
  }

  /** 读取 downfed 为当前 Federation 保存的有效管理员 Session。 */
  readAdminSession(federation_url: string): string | undefined {
    return read_city_admin_session_for_url(federation_url);
  }

  private async verifyCurrentUser(
    user: ResolvedCityUser,
    session_user_id?: string,
  ): Promise<ResolvedCityUser> {
    const embassy = new Embassy({
      federation_url: user.federation_url,
      user_token: user.user_token,
    });
    const result = await embassy.user.service("accounts").get<CityAccountsMeResult>("me");
    const token_user_id = readString(result.user?.user_id);
    const token_bureau_id = typeof result.user?.bureau_id === "string"
      ? result.user.bureau_id
      : "";
    if (!token_user_id) {
      throw new Error("City user token resolved without a user_id. Run `city city login` again.");
    }
    if (!token_bureau_id) {
      throw new Error("City user token resolved without a bureau_id. Run `city city login` again.");
    }
    if (session_user_id && !user.env_overrides.user_token && session_user_id !== token_user_id) {
      throw new Error([
        "City session user does not match the authenticated token.",
        `session=${session_user_id}`,
        `token=${token_user_id}`,
        "Run `city city logout` and then `city city login`.",
      ].join(" "));
    }

    const email = readString(result.profile?.email);
    const display_name = readString(result.profile?.display_name);
    return {
      ...user,
      bureau_id: token_bureau_id,
      user_id: token_user_id,
      user_label: email || display_name || token_user_id,
    };
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFirstEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = readString(env[key]);
    if (value) return value;
  }
  return "";
}
