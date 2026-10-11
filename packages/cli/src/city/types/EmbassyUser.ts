/**
 * CLI 当前 Embassy 用户身份类型。
 *
 * 关键点（中文）
 * - 这些类型描述 CLI 当前通过 Embassy 使用的 Federation 用户身份。
 * - 环境变量覆盖与 `city federation login` 保存的 Session 会归一到同一个身份结构。
 */

/**
 * Embassy 用户身份来源。
 */
export type EmbassyUserSource = "embassy-session" | "env";

/**
 * Embassy 用户环境变量覆盖情况。
 */
export interface EmbassyUserEnvOverrides {
  /**
   * Federation URL 是否来自环境变量。
   */
  federation_url: boolean;

  /**
   * Federation User Token 是否来自环境变量。
   */
  user_token: boolean;
}

/**
 * 当前有效 Embassy 用户身份。
 */
export interface ResolvedEmbassyUser {
  /**
   * Federation URL。
   */
  federation_url: string;

  /**
   * 当前产品的 Bureau ID。
   */
  bureau_id: string;

  /**
   * Federation User Token。
   */
  user_token: string;

  /**
   * Token 实际解析出的 Federation User ID。
   */
  user_id?: string;

  /**
   * 用户展示名，例如 email、profile display name 或 user id。
   */
  user_label?: string;

  /**
   * 当前身份来源。
   */
  source: EmbassyUserSource;

  /**
   * 环境变量覆盖情况。
   */
  env_overrides: EmbassyUserEnvOverrides;

  /**
   * 诊断提示。
   */
  warnings: string[];
}

/**
 * Embassy 用户身份解析参数。
 */
export interface ResolveEmbassyUserInput {
  /**
   * 用于读取显式覆盖项的环境变量。
   */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;

  /**
   * 是否允许环境变量覆盖 `city federation login` 保存的 Session。
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
