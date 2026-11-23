/**
 * Downtown 用户账户访问器。
 *
 * 该模块封装现有 Accounts Service 登录原语，并把成功返回的 User Token
 * 写回当前 Downtown 实例。公开登录不依赖旧会话；宿主仍负责交互和持久化。
 */

import type {
  DowntownAccountContinueInput,
  DowntownAccountExchangeInput,
  DowntownAccountDoneResult,
  DowntownAccountLoginOptions,
  DowntownAccountLoginResult,
  DowntownAccountLoginStartInput,
  DowntownAccountProvider,
} from "./types/DowntownAccount.js";
import type { DowntownAccountOptions } from "./types/DowntownInternal.js";

/** Downtown Accounts Service 访问器。 */
export class DowntownAccount {
  private readonly options: DowntownAccountOptions;
  /** Public identifier of the current flow. */
  private login_id?: string;
  /** Private initiating-client claim proof. */
  private login_secret?: string;
  /** Exchange identifier retained across transport retries. */
  private exchange_id?: string;

  constructor(options: DowntownAccountOptions) {
    this.options = options;
  }

  /** 读取 Downtown 动态发布的登录 Provider。 */
  async providers(): Promise<DowntownAccountProvider[]> {
    const result = await this.options.public_accounts()
      .get<{ items?: DowntownAccountProvider[] }>("providers");
    return result.items ?? [];
  }

  /** 开始一个现有 Accounts Service 登录流程。 */
  async login_start(
    input: DowntownAccountLoginStartInput,
  ): Promise<DowntownAccountLoginResult> {
    const result = await this.options.public_accounts()
      .action("login/start")
      .invoke<DowntownAccountLoginResult>(input);
    this.login_id = read_login_id(result);
    this.login_secret = read_required_login_id(result.login_secret);
    this.exchange_id = undefined;
    return result;
  }

  /** 向当前登录流程提交 Provider 输入。 */
  async continue(
    input: DowntownAccountContinueInput,
  ): Promise<DowntownAccountLoginResult> {
    const login_id = read_required_login_id(input.login_id ?? this.login_id);
    if (input.login_secret) {
      if (login_id !== this.login_id) this.exchange_id = undefined;
      this.login_id = login_id;
      this.login_secret = input.login_secret;
    }
    if (login_id !== this.login_id) throw new Error("login proof for this flow is required");
    const result = await this.options.public_accounts()
      .action("login/continue")
      .invoke<DowntownAccountLoginResult>({
        ...input,
        login_id,
        login_secret: read_required_login_id(this.login_secret),
      });
    this.login_id = read_login_id(result);
    return result;
  }

  /** Query state only. Supply both fields to restore a securely persisted flow after web navigation. */
  async status(login_id?: string, login_secret?: string): Promise<DowntownAccountLoginResult> {
    const current_login_id = read_required_login_id(login_id ?? this.login_id);
    if (login_secret) {
      if (current_login_id !== this.login_id) this.exchange_id = undefined;
      this.login_id = current_login_id;
      this.login_secret = login_secret;
    }
    if (current_login_id !== this.login_id) throw new Error("login proof for this flow is required");
    return await this.options.public_accounts().action("login/result").invoke<DowntownAccountLoginResult>({
      login_id: current_login_id,
      login_secret: read_required_login_id(this.login_secret),
    });
  }

  /** Exchange once; retry this method after transport failure to reuse the same exchange_id. */
  async exchange(input: DowntownAccountExchangeInput = {}): Promise<DowntownAccountDoneResult> {
    const { exchange_id } = input;
    const login_id = read_required_login_id(this.login_id);
    const login_secret = read_required_login_id(this.login_secret);
    if (exchange_id && this.exchange_id && exchange_id !== this.exchange_id) {
      throw new Error("reuse the original exchange_id for login retries");
    }
    this.exchange_id ??= exchange_id ?? crypto.randomUUID();
    const result = await this.options.public_accounts().action("login/exchange").invoke<DowntownAccountDoneResult>({
      ...input, login_id, login_secret, exchange_id: this.exchange_id,
    });
    if (!result.user_token) throw new Error("login exchange returned no token");
    this.accept_user_token(result);
    return result;
  }

  /**
   * 执行一次宿主无关的登录编排。
   *
   * 没有提供输入或 OAuth 回调时，返回当前步骤，由宿主继续处理。
   */
  async login(options: DowntownAccountLoginOptions): Promise<DowntownAccountLoginResult> {
    let result = await this.login_start(options);
    if (result.status === "input_required") {
      if (!options.input) return result;
      result = await this.continue({
        login_id: result.login_id,
        input: options.input,
      });
    }
    if (result.status === "redirect_required") {
      if (!options.on_authorize) return result;
      const proof = await options.on_authorize(result.url);
      if (!proof.authorization_code || !proof.code_verifier) throw new TypeError("OAuth callback authorization_code and code_verifier required");
      return await this.exchange(proof);
    }
    if (result.status === "done" && !result.user_token) {
      return await this.exchange();
    }
    return result;
  }

  /** 读取当前 Downtown 实例中的 User Token。 */
  token(): string | undefined {
    return this.options.read_user_token();
  }

  /** Revoke before clearing local credentials; failure preserves the token for retry. */
  async logout(refresh_token?: string): Promise<void> {
    if (this.options.read_user_token() || refresh_token) {
      try {
        await this.options.accounts().action("logout").invoke({ refresh_token });
      } catch (error) {
        // 已撤销/到期可安全清理；网络或存储故障必须保留凭据以便重试。
        if ((error as { /** HTTP 鉴权失败状态。 */ status?: number }).status !== 401) throw error;
      }
    }
    this.login_id = undefined;
    this.login_secret = undefined;
    this.exchange_id = undefined;
    this.options.update_user_token(undefined);
  }

  private accept_user_token(result: DowntownAccountLoginResult): void {
    if (result.status !== "done") return;
    const done = result as DowntownAccountDoneResult;
    if (typeof done.user_token === "string" && done.user_token.trim()) {
      this.options.update_user_token(done.user_token.trim());
    }
  }
}

function read_login_id(result: DowntownAccountLoginResult): string {
  return read_required_login_id(result.login_id);
}

function read_required_login_id(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("login_id is required");
  }
  return value.trim();
}
