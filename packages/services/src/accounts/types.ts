/**
 * Accounts 服务 provider 类型定义。
 *
 * 关键说明（中文）
 * - AccountsService 是统一账号服务容器，具体登录能力由 provider 声明。
 * - provider 负责声明 env、判断是否可用，并提供必要的发送或 OAuth 配置能力。
 */

import type { EnvRequirement } from "@downcity/city";
import type { OAuthProviderConfig, OAuthProviderId } from "./oauth.js";

/**
 * Accounts provider 内部能力类型。
 */
export type AccountsProviderKind = "password" | "oauth";

/**
 * Accounts 产品侧登录交互类型。
 *
 * 关键说明（中文）
 * - `oauth` 表示服务端返回第三方授权 URL，产品侧跳转或打开浏览器。
 * - `input` 表示产品侧先按 `inputs` 收集用户输入，再调用统一登录入口验证。
 */
export type AccountsAuthFlow = "oauth" | "input";

/**
 * Accounts 输入字段类型。
 */
export type AccountsAuthInputType = "text" | "password";

/**
 * Accounts 登录方式不可用原因。
 */
export type AccountsProviderReason = "not_configured" | "not_supported";

/**
 * Accounts provider 运行时上下文。
 */
export interface AccountsProviderContext {
  /**
   * 读取 City runtime env。
   */
  env(key: string): string | undefined;
}

/**
 * Accounts 登录输入字段。
 */
export interface AccountsAuthInputField {
  /**
   * 字段名称，会作为 `login/continue` 的 `input` 对象 key。
   */
  name: string;

  /**
   * 字段类型，用于产品侧选择输入控件。
   */
  type: AccountsAuthInputType;

  /**
   * 字段展示名称。
   */
  label: string;

  /**
   * 是否必须填写。
   */
  required: boolean;
}

/**
 * Accounts 登录方式返回项。
 */
export interface AccountsProviderItem {
  /**
   * 登录方式唯一标识，例如 `email`、`github`。
   */
  id: string;

  /**
   * 产品侧登录交互类型。
   */
  type: AccountsAuthFlow;

  /**
   * 当前 City 是否实际开放该登录方式。
   */
  enabled: boolean;

  /**
   * 展示给前端或 CLI 的登录方式名称。
   */
  label: string;

  /**
   * 当前登录方式需要产品侧提前收集的输入字段。
   *
   * 关键说明（中文）
   * - OAuth provider 不需要提前输入，返回空数组。
   * - Local Account 也使用 input 流程，但输入为空数组。
   */
  inputs: AccountsAuthInputField[];

  /**
   * email login 是否启用。
   */
  login_enabled?: boolean;

  /**
   * email register 是否启用。
   */
  register_enabled?: boolean;

  /**
   * 未启用原因。
   */
  reason?: AccountsProviderReason;
}

/**
 * Accounts 服务配置。
 */
export interface AccountsServiceOptions {
  /**
   * 登录、验证邮箱或 OAuth 完成后签发的 City user_token 有效期。
   */
  token_ttl?: string;

  /**
   * 当前 City 启用的账号 provider。
   */
  providers?: AccountsProvider[];

  /**
   * 是否启用本机账户登录。
   *
   * 关键说明（中文）
   * - 开启后 `/providers` 只返回 `local` 登录方式。
   * - 仅建议在监听 `127.0.0.1` / `localhost` 的本机 Federation HTTP 服务中开启。
   */
  local_login?: boolean;
}

/** Usage 分析可读取的注册用户最小事实。 */
export interface AccountsUsageRegistration {
  /** Federation 内全局用户 ID。 */
  user_id: string;
  /** 用户首次注册时间，UTC ISO 字符串。 */
  created_at: string;
}

/**
 * Accounts provider 基础定义。
 */
export interface AccountsProvider {
  /**
   * provider ID。
   */
  id: string;

  /**
   * provider 展示名。
   */
  label: string;

  /**
   * provider 类型。
   */
  type: AccountsProviderKind;

  /**
   * provider 需要暴露给 env 管理的配置项。
   */
  env: EnvRequirement[];

  /**
   * 生成登录方式展示信息。
   */
  method(ctx: AccountsProviderContext): AccountsProviderItem;
}

/**
 * 验证邮件发送参数。
 */
export interface AccountsEmailSendParams {
  /**
   * 收件人邮箱。
   */
  to: string;

  /**
   * 邮件标题。
   */
  subject: string;

  /**
   * 纯文本邮件内容。
   */
  text: string;
}

/**
 * Email accounts provider。
 */
export interface AccountsEmailProvider extends AccountsProvider {
  /**
   * provider ID，固定为 `email`。
   */
  id: "email";

  /**
   * provider 类型，固定为 password。
   */
  type: "password";

  /**
   * 发送验证邮件。
   */
  send_email(params: AccountsEmailSendParams): Promise<void>;
}

/**
 * OAuth accounts provider。
 */
export interface AccountsOAuthProvider extends AccountsProvider {
  /**
   * provider ID。
   */
  id: OAuthProviderId;

  /**
   * provider 类型，固定为 oauth。
   */
  type: "oauth";

  /**
   * 读取当前 provider 的 OAuth 配置。
   */
  config(ctx: AccountsProviderContext): OAuthProviderConfig | undefined;
}

/**
 * Accounts 登录启动请求。
 */
export interface AccountsLoginStartRequest extends Record<string, unknown> {
  /**
   * 目标登录 provider ID，例如 `github`、`email` 或 `local`。
   */
  provider?: string;

  /**
   * 需要签发 `user_token` 的稳定 Bureau ID。
   */
  bureau_id?: string;
}

/**
 * Accounts 登录继续请求。
 */
export interface AccountsLoginContinueRequest extends Record<string, unknown> {
  /**
   * `login/start` 返回的登录流程 ID。
   */
  login_id?: string;

  /**
   * 产品侧按当前步骤 `inputs` 收集到的输入。
   */
  input?: Record<string, unknown>;
}

/**
 * Accounts 登录结果读取请求。
 */
export interface AccountsLoginResultRequest extends Record<string, unknown> {
  /**
   * `login/start` 返回的登录流程 ID。
   */
  login_id?: string;
}

/**
 * Accounts 登录状态。
 */
export type AccountsLoginStatus = "input_required" | "redirect_required" | "pending" | "done";

/**
 * 输入步骤结果。
 */
export interface AccountsLoginInputRequiredResult {
  /**
   * 当前登录状态。
   */
  status: "input_required";

  /**
   * 登录流程 ID。
   */
  login_id: string;

  /**
   * provider ID。
   */
  provider: string;

  /**
   * 当前步骤需要产品侧收集的输入字段。
   */
  inputs: AccountsAuthInputField[];
}

/**
 * OAuth 跳转步骤结果。
 */
export interface AccountsLoginRedirectRequiredResult {
  /**
   * 当前登录状态。
   */
  status: "redirect_required";

  /**
   * 登录流程 ID。
   */
  login_id: string;

  /**
   * OAuth provider ID。
   */
  provider: OAuthProviderId;

  /**
   * 需要产品侧打开或跳转的 OAuth 授权 URL。
   */
  url: string;

  /**
   * OAuth state，等同于 `login_id`。
   */
  state: string;
}

/**
 * 登录待完成结果。
 */
export interface AccountsLoginPendingResult {
  /**
   * 当前登录状态。
   */
  status: "pending";

  /**
   * 登录流程 ID。
   */
  login_id: string;

  /**
   * provider ID。
   */
  provider?: string;
}

/**
 * 登录完成结果。
 */
export interface AccountsLoginDoneResult {
  /**
   * 当前登录状态。
   */
  status: "done";

  /**
   * 登录流程 ID。
   */
  login_id: string;

  /**
   * 完成登录的 provider ID。
   */
  provider?: string;

  /**
   * City user token。
   */
  user_token?: string;

  /**
   * City 用户 ID。
   */
  user_id?: string;

  /**
   * 用户 email，仅 email 登录等有邮箱的 provider 返回。
   */
  email?: string;
}

/**
 * Accounts 登录入口结果。
 */
export type AccountsLoginStartResult =
  | AccountsLoginInputRequiredResult
  | AccountsLoginRedirectRequiredResult
  | AccountsLoginDoneResult;

/**
 * Accounts 登录继续结果。
 */
export type AccountsLoginContinueResult =
  | AccountsLoginInputRequiredResult
  | AccountsLoginPendingResult
  | AccountsLoginDoneResult;

/**
 * Accounts 登录结果查询结果。
 */
export type AccountsLoginResult = AccountsLoginPendingResult | AccountsLoginDoneResult;

/**
 * Email accounts provider 配置。
 */
export interface EmailAccountsProviderOptions {
  /**
   * 展示名称。
   */
  label?: string;

  /**
   * provider 需要暴露给 env 管理的配置项。
   */
  env?: EnvRequirement[];

  /**
   * 自定义可用性判断。
   *
   * 用于 SMTP、SendGrid、Resend 等发送能力由 env 驱动的场景。
   */
  enabled?: (ctx: AccountsProviderContext) => boolean;

  /**
   * 发送验证邮件。
   */
  send_email: (params: AccountsEmailSendParams) => Promise<void>;
}

/**
 * OAuth accounts provider 配置。
 */
export interface OAuthAccountsProviderOptions {
  /**
   * 展示名称。
   */
  label?: string;

  /**
   * OAuth client id。
   */
  client_id?: string;

  /**
   * OAuth client secret。
   */
  client_secret?: string;
}
