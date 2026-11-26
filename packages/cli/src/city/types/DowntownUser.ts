/**
 * CLI 当前 Downtown 用户身份类型。
 *
 * 关键点（中文）
 * - 这些类型描述 CLI 当前通过 Downtown 使用的 Downtown 用户身份。
 * - 环境变量覆盖与 `city towns login` 保存的 Session 会归一到同一个身份结构。
 */

/**
 * Downtown 用户身份来源。
 */
export type DowntownUserSource = "downtown-session" | "env";

/**
 * Downtown 用户环境变量覆盖情况。
 */
export interface DowntownUserEnvOverrides {
  /**
   * Downtown URL 是否来自环境变量。
   */
  downtown_url: boolean;

  /**
   * Downtown User Token 是否来自环境变量。
   */
  user_token: boolean;
}

/**
 * 当前有效 Downtown 用户身份。
 */
export interface ResolvedDowntownUser {
  /**
   * Downtown URL。
   */
  downtown_url: string;


  /**
   * Downtown User Token。
   */
  user_token: string;
  /** 共享凭证仓储中的稳定登录 ID，运行时按此读取最新凭证。 */
  session_id?: string;

  /**
   * Token 实际解析出的 Downtown User ID。
   */
  user_id?: string;

  /**
   * 用户展示名，例如 email、profile display name 或 user id。
   */
  user_label?: string;

  /**
   * 当前身份来源。
   */
  source: DowntownUserSource;

  /**
   * 环境变量覆盖情况。
   */
  env_overrides: DowntownUserEnvOverrides;

  /**
   * 诊断提示。
   */
  warnings: string[];
}

/**
 * Downtown 用户身份解析参数。
 */
export interface ResolveDowntownUserInput {
  /**
   * 用于读取显式覆盖项的环境变量。
   */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;

  /**
   * 是否允许环境变量覆盖 `city towns login` 保存的 Session。
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
