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
  /** 登录 Provider ID。 */
  provider: string;

  /** 需要签发 User Token 的 Bureau ID。 */
  bureau_id?: string;
}

/** 继续登录流程的输入。 */
export interface EmbassyAccountContinueInput extends Record<string, unknown> {
  /** login_start 返回的登录流程 ID；省略时使用当前流程。 */
  login_id?: string;

  /** 当前 Provider 步骤要求的输入。 */
  input?: Record<string, unknown>;
}

/** 登录流程公共字段。 */
export interface EmbassyAccountLoginBaseResult extends Record<string, unknown> {
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

  /** OAuth state。 */
  state?: string;
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

  /** 登录成功后签发的 User Token。 */
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

  /** OAuth 授权 URL 发布给宿主的回调。 */
  on_authorize?: (url: string) => void | Promise<void>;

  /** OAuth 或异步 Provider 的轮询间隔，单位毫秒。 */
  poll_interval_ms?: number;

  /** OAuth 或异步 Provider 的最大轮询次数。 */
  max_poll_attempts?: number;
}
