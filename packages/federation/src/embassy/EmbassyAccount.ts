/**
 * Embassy 用户账户访问器。
 *
 * 该模块封装现有 Accounts Service 登录原语，并把成功返回的 User Token
 * 写回当前 Embassy 实例。宿主仍负责交互和持久化。
 */

import type {
  EmbassyAccountContinueInput,
  EmbassyAccountDoneResult,
  EmbassyAccountLoginOptions,
  EmbassyAccountLoginResult,
  EmbassyAccountLoginStartInput,
  EmbassyAccountProvider,
} from "./types/EmbassyAccount.js";
import type { EmbassyAccountOptions } from "./types/EmbassyInternal.js";

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 180;

/** Federation Accounts Service 访问器。 */
export class EmbassyAccount {
  private readonly options: EmbassyAccountOptions;
  /** Public identifier of the current flow. */
  private login_id?: string;
  /** Private initiating-client claim proof. */
  private login_secret?: string;
  /** Exchange identifier retained across transport retries. */
  private exchange_id?: string;

  constructor(options: EmbassyAccountOptions) {
    this.options = options;
  }

  /** 读取 Federation 动态发布的登录 Provider。 */
  async providers(): Promise<EmbassyAccountProvider[]> {
    const result = await this.options.accounts()
      .get<{ items?: EmbassyAccountProvider[] }>("providers");
    return result.items ?? [];
  }

  /** 开始一个现有 Accounts Service 登录流程。 */
  async login_start(
    input: EmbassyAccountLoginStartInput,
  ): Promise<EmbassyAccountLoginResult> {
    const result = await this.options.accounts()
      .action("login/start")
      .invoke<EmbassyAccountLoginResult>(input);
    this.login_id = read_login_id(result);
    this.login_secret = read_required_login_id(result.login_secret);
    this.exchange_id = undefined;
    return result;
  }

  /** 向当前登录流程提交 Provider 输入。 */
  async continue(
    input: EmbassyAccountContinueInput,
  ): Promise<EmbassyAccountLoginResult> {
    const login_id = read_required_login_id(input.login_id ?? this.login_id);
    if (input.login_secret) {
      if (login_id !== this.login_id) this.exchange_id = undefined;
      this.login_id = login_id;
      this.login_secret = input.login_secret;
    }
    if (login_id !== this.login_id) throw new Error("login proof for this flow is required");
    const result = await this.options.accounts()
      .action("login/continue")
      .invoke<EmbassyAccountLoginResult>({
        ...input,
        login_id,
        login_secret: read_required_login_id(this.login_secret),
      });
    this.login_id = read_login_id(result);
    return result;
  }

  /** Query state only. Supply both fields to restore a securely persisted flow after web navigation. */
  async status(login_id?: string, login_secret?: string): Promise<EmbassyAccountLoginResult> {
    const current_login_id = read_required_login_id(login_id ?? this.login_id);
    if (login_secret) {
      if (current_login_id !== this.login_id) this.exchange_id = undefined;
      this.login_id = current_login_id;
      this.login_secret = login_secret;
    }
    if (current_login_id !== this.login_id) throw new Error("login proof for this flow is required");
    return await this.options.accounts().action("login/result").invoke<EmbassyAccountLoginResult>({
      login_id: current_login_id,
      login_secret: read_required_login_id(this.login_secret),
    });
  }

  /** Exchange once; retry this method after transport failure to reuse the same exchange_id. */
  async exchange(exchange_id?: string): Promise<EmbassyAccountDoneResult> {
    const login_id = read_required_login_id(this.login_id);
    const login_secret = read_required_login_id(this.login_secret);
    if (exchange_id && this.exchange_id && exchange_id !== this.exchange_id) {
      throw new Error("reuse the original exchange_id for login retries");
    }
    this.exchange_id ??= exchange_id ?? crypto.randomUUID();
    const result = await this.options.accounts().action("login/exchange").invoke<EmbassyAccountDoneResult>({
      login_id, login_secret, exchange_id: this.exchange_id,
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
  async login(options: EmbassyAccountLoginOptions): Promise<EmbassyAccountLoginResult> {
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
      await options.on_authorize(result.url, result.user_code);
      return await this.poll_until_complete(options);
    }
    if (result.status === "pending") {
      return await this.poll_until_complete(options);
    }
    if (result.status === "done" && !result.user_token) {
      return await this.exchange();
    }
    return result;
  }

  /** 读取当前 Embassy 实例中的 User Token。 */
  token(): string | undefined {
    return this.options.read_user_token();
  }

  /** Revoke before clearing local credentials; failure preserves the token for retry. */
  async logout(): Promise<void> {
    if (this.options.read_user_token()) {
      try {
        await this.options.accounts().action("logout").invoke({});
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

  private async poll_until_complete(
    options: EmbassyAccountLoginOptions,
  ): Promise<EmbassyAccountLoginResult> {
    const interval_ms = read_positive_integer(
      options.poll_interval_ms,
      DEFAULT_POLL_INTERVAL_MS,
      "poll_interval_ms",
    );
    const max_attempts = read_positive_integer(
      options.max_poll_attempts,
      DEFAULT_MAX_POLL_ATTEMPTS,
      "max_poll_attempts",
    );
    let result: EmbassyAccountLoginResult | undefined;
    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      result = await this.status();
      if (result.status === "done") return await this.exchange();
      await new Promise<void>((resolve) => setTimeout(resolve, interval_ms));
    }
    throw new Error("Federation account login timed out");
  }

  private accept_user_token(result: EmbassyAccountLoginResult): void {
    if (result.status !== "done") return;
    const done = result as EmbassyAccountDoneResult;
    if (typeof done.user_token === "string" && done.user_token.trim()) {
      this.options.update_user_token(done.user_token.trim());
    }
  }
}

function read_login_id(result: EmbassyAccountLoginResult): string {
  return read_required_login_id(result.login_id);
}

function read_required_login_id(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("login_id is required");
  }
  return value.trim();
}

function read_positive_integer(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(field + " must be a positive integer");
  }
  return value;
}
