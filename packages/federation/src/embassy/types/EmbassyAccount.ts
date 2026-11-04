/**
 * Embassy 用户账户协议类型。
 *
 * 这些类型只描述现有 Accounts Service 登录协议，不包含 CLI 或 Desktop 交互逻辑。
 */

/** Accounts Service 发布的登录输入字段。 */
export interface EmbassyAccountInputField extends Record<string, unknown> {
  /** 输入字段名称。 */
  name: string;

  /** 面向用户展示的字段名称。 */
  label?: string;

  /** 输入字段类型。 */
  type?: string;

  /** 当前字段是否必须提供。 */
  required?: boolean;
}

/** Accounts Service 发布的登录 Provider。 */
export interface EmbassyAccountProvider extends Record<string, unknown> {
  /** Provider 稳定 ID。 */
  id: string;

  /** Provider 展示名称。 */
  label?: string;

  /** Provider 交互类型。 */
  type: string;

  /** Provider 当前是否可用。 */
  enabled: boolean;

  /** Provider 是否允许登录。 */
  login_enabled?: boolean;

  /** Provider 是否允许注册。 */
  register_enabled?: boolean;

  /** Provider 登录时需要宿主收集的输入字段。 */
  inputs?: EmbassyAccountInputField[];
}

/** 开始登录流程的输入。 */
export interface EmbassyAccountLoginStartInput extends Record<string, unknown> {
  /** 产品交互方式；OAuth 均要求产品回调、随机 state 与 S256 PKCE。 */
  client_type: "web" | "cli" | "desktop";

  /** 登录 Provider ID。 */
  provider: string;

  /** 需要签发 User Token 的 Bureau ID。 */
  bureau_id?: string;

  /** 网站为 Bureau server_url 下 /api/auth/callback，CLI/Desktop 为临时 127.0.0.1 回调。 */
  redirect_uri?: string;
  /** 产品回调随机 state，独立于 Provider OAuth state。 */
  state?: string;
  /** S256 PKCE challenge，verifier 仅由发起产品保管。 */
  code_challenge?: string;
  /** OAuth 只接受 S256。 */
  code_challenge_method?: "S256";
}

/** Token 交换参数；全部 OAuth 必须提交产品回调收到的授权码和 PKCE verifier。 */
export interface EmbassyAccountExchangeInput {
  /** 随机幂等标识；省略时自动生成，并在同一事务的传输重试间复用。 */
  exchange_id?: string;
  /** 浏览器通过已绑定产品回调交付的一次性授权码。 */
  authorization_code?: string;
  /** 发起产品生成并保管的 PKCE verifier，不能通过回调 URL 交付。 */
  code_verifier?: string;
}

/** 继续登录流程的输入。 */
export interface EmbassyAccountContinueInput extends Record<string, unknown> {
  /** Private start proof; omit to use this accessor's current flow. Never place in URLs or logs. */
  login_secret?: string;
  /** login_start 返回的登录流程 ID；省略时使用当前流程。 */
  login_id?: string;

  /** 当前 Provider 步骤要求的输入。 */
  input?: Record<string, unknown>;
}

/** 登录流程公共字段。 */
export interface EmbassyAccountLoginBaseResult extends Record<string, unknown> {
  /** Private claim credential, returned only by login_start; retain securely for resumed flows. */
  login_secret?: string;
  /** 当前登录状态。 */
  status: "input_required" | "redirect_required" | "pending" | "done";

  /** 登录流程 ID。 */
  login_id: string;

  /** 当前登录 Provider ID。 */
  provider?: string;

  /** Federation 返回的错误信息。 */
  error?: string;
}

/** 登录流程需要宿主输入。 */
export interface EmbassyAccountInputRequiredResult extends EmbassyAccountLoginBaseResult {
  /** 当前状态固定为需要输入。 */
  status: "input_required";

  /** 当前步骤需要收集的字段。 */
  inputs: EmbassyAccountInputField[];
}

/** 登录流程需要浏览器授权。 */
export interface EmbassyAccountRedirectResult extends EmbassyAccountLoginBaseResult {
  /** 当前状态固定为需要跳转。 */
  status: "redirect_required";

  /** 宿主需要打开的授权 URL。 */
  url: string;

}

/** 登录流程仍在等待。 */
export interface EmbassyAccountPendingResult extends EmbassyAccountLoginBaseResult {
  /** 当前状态固定为等待。 */
  status: "pending";
}

/** 登录流程已经完成。 */
export interface EmbassyAccountDoneResult extends EmbassyAccountLoginBaseResult {
  /** 当前状态固定为完成。 */
  status: "done";

  /** User Token, present only after exchange or successful high-level login; status never returns it. */
  user_token?: string;

  /** 登录成功后的 Federation 用户 ID。 */
  user_id?: string;

  /** Provider 可选返回的用户邮箱。 */
  email?: string;
}

/** Accounts 登录流程结果。 */
export type EmbassyAccountLoginResult =
  | EmbassyAccountInputRequiredResult
  | EmbassyAccountRedirectResult
  | EmbassyAccountPendingResult
  | EmbassyAccountDoneResult;

/** 高级登录编排参数。 */
export interface EmbassyAccountLoginOptions extends EmbassyAccountLoginStartInput {
  /** 输入型 Provider 需要提交的字段。 */
  input?: Record<string, unknown>;

  /** 宿主打开浏览器，验证产品回调 state 后返回授权码与 verifier；跨页面网站使用 login_start/exchange。 */
  on_authorize?: (url: string) => Promise<EmbassyAccountExchangeInput>;
}
