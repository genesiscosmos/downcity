/**
 * City 当前 City user 身份类型。
 *
 * 关键点（中文）
 * - 这些类型描述“City 当前实际会用哪个 City user 调用服务”。
 * - env 覆盖与 `city city login` session 会统一归一到同一个身份结构。
 */

/**
 * City user 身份来源。
 */
export type CityUserSource = "city-session" | "env";

/**
 * City user 环境变量覆盖情况。
 */
export interface CityUserEnvOverrides {
  /**
   * City base URL 是否来自环境变量。
   */
  federation_url: boolean;

  /**
   * City user token 是否来自环境变量。
   */
  user_token: boolean;
}

/**
 * 当前有效 City user 身份。
 */
export interface ResolvedCityUser {
  /**
   * City base URL。
   */
  federation_url: string;

  /**
   * 当前产品的 Bureau ID。
   */
  bureau_id: string;

  /**
   * City user token。
   */
  user_token: string;

  /**
   * token 实际解析出的 City user id。
   */
  user_id?: string;

  /**
   * 用户展示名，例如 email、profile display name 或 user id。
   */
  user_label?: string;

  /**
   * 当前身份来源。
   */
  source: CityUserSource;

  /**
   * 环境变量覆盖情况。
   */
  env_overrides: CityUserEnvOverrides;

  /**
   * 诊断提示。
   */
  warnings: string[];
}

/**
 * City user 解析参数。
 */
export interface ResolveCityUserInput {
  /**
   * 用于读取显式覆盖项的环境变量。
   */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;

  /**
   * 是否允许 env 覆盖 `city city login` session。
   */
  allow_env_override?: boolean;

  /**
   * 是否要求必须存在 user token。
   */
  require_user_token?: boolean;

  /**
   * 是否通过 `accounts/me` 校验 token 实际 user。
   */
  verify_user?: boolean;
}

/**
 * `accounts/me` 的最小返回结构。
 */
export interface CityAccountsMeResult {
  /**
   * 当前 token 解析出的 user。
   */
  user?: {
    /**
     * City 用户 ID。
     */
    user_id?: string;

    /**
     * Token 中已经验证的 Bureau ID。
     */
    bureau_id?: string;
  };

  /**
   * 当前用户资料。
   */
  profile?: {
    /**
     * 用户 email。
     */
    email?: string;

    /**
     * 用户展示名称。
     */
    display_name?: string;
  } | null;
}
