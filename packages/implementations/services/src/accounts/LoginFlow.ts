/**
 * OAuth 授权码交付状态机：发起端私密证明、Provider 浏览器绑定、产品回调与 PKCE，
 * 以及有界幂等交换。状态查询只返回进度，永远不能交付授权码或 Token。
 */
import { httpError } from "@downcity/federation";
import type { ServiceDatabaseContext } from "@downcity/federation";
import { service_sql_database } from "../shared/database-sql.js";
import { LOGIN_FLOW_TABLE, type LoginFlowRow } from "./login-schema.js";
import { randomToken } from "./utils.js";
import { oauth_code_challenge, oauth_login_parameters } from "./oauth-login-proof.js";
import type { AccountsLoginStartRequest } from "./types.js";

/** SHA-256 digest for random bearer credentials. */
async function digest_secret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Bounded ephemeral login persistence and browser authorization. */
export class LoginFlow {
  /** 当前方言的参数化数据库入口。 */
  private readonly database: ServiceDatabaseContext;

  constructor(database: ServiceDatabaseContext, private readonly trusted_web_callbacks: readonly string[] = []) {
    this.database = service_sql_database(database);
  }

  /** Erase expired credentials, including retained exchange responses. */
  async cleanup(): Promise<void> {
    await this.database.query({
      sql: `DELETE FROM ${LOGIN_FLOW_TABLE} WHERE expires_at <= ? OR (phase = 'exchanged' AND retry_until <= ?)`,
      params: [Date.now(), Date.now()],
    });
  }

  /** 创建短期事务；网站回调由宿主显式白名单提供，秘密只通过 JSON 返回。 */
  async start(provider: string, client_type: unknown, request: Request, input: Partial<AccountsLoginStartRequest> = {}) {
    if (client_type !== "web" && client_type !== "cli" && client_type !== "desktop") {
      throw httpError(400, "explicit client_type web, cli or desktop required");
    }
    const oauth = provider !== "email" && provider !== "local";
    if (client_type === "web" && !oauth) this.require_same_origin(request);
    await this.cleanup();
    const login_id = randomToken(24);
    const login_secret = randomToken(32);
    const browser_secret = randomToken(32);
    const callback = oauth ? oauth_login_parameters({ ...input, client_type }, this.trusted_web_callbacks)
      : { redirect_uri: "", callback_state: "", code_challenge: "" };
    await this.database.query({
      sql: `INSERT INTO ${LOGIN_FLOW_TABLE} (login_id, secret_hash, provider, client_type, oauth_state, browser_hash, redirect_uri, callback_state, code_challenge, authorization_code_hash, phase, user_id, user_token, exchange_hash, retry_until, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'created', '', '', '', 0, ?)`,
      params: [login_id, await digest_secret(login_secret), provider, client_type,
        randomToken(32), client_type === "web" && !oauth ? await digest_secret(browser_secret) : "",
        callback.redirect_uri, callback.callback_state, callback.code_challenge, Date.now() + 300_000],
    });
    return {
      login_id, login_secret,
      cookie: client_type === "web" && !oauth ? this.cookie(login_id, browser_secret, request) : undefined,
    };
  }

  /** Load an unexpired flow after erasing old sensitive material. */
  async read(login_id: string): Promise<LoginFlowRow> {
    await this.cleanup();
    const result = await this.database.query({ sql: `SELECT * FROM ${LOGIN_FLOW_TABLE} WHERE login_id = ?`, params: [login_id] });
    const row = result.rows[0] as LoginFlowRow | undefined;
    if (!row) throw httpError(404, "login expired or invalid");
    return row;
  }

  /** 验证发起证明；Email/local web 还要求同源 Cookie，OAuth 交付由回调码与 PKCE 绑定。 */
  async claim(login_id: string, login_secret: string, request: Request): Promise<LoginFlowRow> {
    const row = await this.read(login_id);
    if (!login_secret || await digest_secret(login_secret) !== row.secret_hash) {
      throw httpError(403, "invalid login proof");
    }
    if (row.client_type === "web" && !row.redirect_uri) {
      this.require_same_origin(request);
      await this.require_browser(row, request);
    }
    return row;
  }

  /** Advance only the expected phase, returning whether this request won the race. */
  async advance(login_id: string, phase: string, next_phase: string): Promise<boolean> {
    const result = await this.database.query({
      sql: `UPDATE ${LOGIN_FLOW_TABLE} SET phase = ? WHERE login_id = ? AND phase = ? AND expires_at > ? RETURNING login_id`,
      params: [next_phase, login_id, phase, Date.now()],
    });
    return result.rows.length === 1;
  }

  /** Save a result without exposing it through status queries. */
  async ready(login_id: string, phase: string, user_token: string): Promise<void> {
    const result = await this.database.query({
      sql: `UPDATE ${LOGIN_FLOW_TABLE} SET phase = 'done', user_token = ?, oauth_state = ? WHERE login_id = ? AND phase = ? AND expires_at > ? RETURNING login_id`,
      params: [user_token, randomToken(32), login_id, phase, Date.now()],
    });
    if (!result.rows.length) throw httpError(409, "login state changed; restart login");
  }

  /** Atomically claim one exchange id; retries with the same id recover the original response. */
  async exchange(row: LoginFlowRow, exchange_id: string) {
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(exchange_id)) throw httpError(400, "random exchange_id required (20-128 URL-safe characters)");
    const exchange_hash = await digest_secret(exchange_id);
    await this.database.query({
      sql: `UPDATE ${LOGIN_FLOW_TABLE} SET phase = 'exchanged', exchange_hash = ?, retry_until = ?, expires_at = ?, user_id = '' WHERE login_id = ? AND phase = 'done' AND expires_at > ? AND (exchange_hash = '' OR exchange_hash = ?)`,
      params: [exchange_hash, Date.now() + 60_000, Date.now() + 60_000, row.login_id, Date.now(), exchange_hash],
    });
    const current = await this.read(row.login_id);
    if (current.phase !== "exchanged" || current.exchange_hash !== exchange_hash) {
      throw httpError(409, "login not ready or already exchanged with another exchange_id");
    }
    return { status: "done" as const, login_id: row.login_id, provider: row.provider, user_token: current.user_token };
  }

  /** Open an authorization landing page, bind this browser, then redirect to the provider. */
  async authorize(login_id: string, request: Request, build_url: (state: string) => string): Promise<Response> {
    const row = await this.read(login_id);
    const browser_secret = randomToken(32);
    const result = await this.database.query({
      sql: `UPDATE ${LOGIN_FLOW_TABLE} SET phase = 'authorizing', browser_hash = ? WHERE login_id = ? AND phase = 'created' AND expires_at > ? RETURNING login_id`,
      params: [await digest_secret(browser_secret), login_id, Date.now()],
    });
    if (!result.rows.length) throw httpError(409, "authorization already started; restart login");
    const headers = new Headers({ location: build_url(row.oauth_state), "cache-control": "no-store", "referrer-policy": "no-referrer" });
    headers.set("set-cookie", this.cookie(login_id, browser_secret, request));
    return new Response(null, { status: 303, headers });
  }

  /** Consume OAuth state once, requiring the browser that began provider authorization. */
  async callback(state: string, request: Request): Promise<LoginFlowRow> {
    await this.cleanup();
    const result = await this.database.query({ sql: `SELECT * FROM ${LOGIN_FLOW_TABLE} WHERE oauth_state = ? AND phase = 'authorizing'`, params: [state] });
    const row = result.rows[0] as LoginFlowRow | undefined;
    if (!row) throw httpError(400, "invalid OAuth state");
    await this.require_browser(row, request);
    if (!await this.advance(row.login_id, "authorizing", "authenticating")) throw httpError(409, "OAuth state already consumed");
    return row;
  }

  /** 浏览器将一次性授权码交付原产品回调；状态查询不暴露授权码或 Token。 */
  async oauth_callback(row: LoginFlowRow, user_id: string): Promise<Response> {
    const authorization_code = randomToken(32);
    const result = await this.database.query({
      sql: `UPDATE ${LOGIN_FLOW_TABLE} SET phase = 'callback_ready', user_id = ?, authorization_code_hash = ?, oauth_state = ? WHERE login_id = ? AND phase = 'authenticating' AND expires_at > ? RETURNING login_id`,
      params: [user_id, await digest_secret(authorization_code), randomToken(32), row.login_id, Date.now()],
    });
    if (!result.rows.length) throw httpError(409, "OAuth login state changed; restart login");
    const url = new URL(row.redirect_uri);
    url.searchParams.set("code", authorization_code);
    url.searchParams.set("state", row.callback_state);
    return new Response(null, { status: 303, headers: { location: url.href, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }

  /** 授权码与 PKCE 均匹配才允许签发；已完成流程只能进入原 exchange_id 的幂等交换。 */
  async begin_oauth_exchange(row: LoginFlowRow, authorization_code: string, code_verifier: string, exchange_id: string): Promise<boolean> {
    if (!authorization_code || await digest_secret(authorization_code) !== row.authorization_code_hash
      || await oauth_code_challenge(code_verifier) !== row.code_challenge) throw httpError(403, "invalid OAuth login proof");
    const exchange_hash = await digest_secret(exchange_id);
    if (row.exchange_hash && row.exchange_hash !== exchange_hash) throw httpError(409, "reuse the original OAuth exchange_id");
    if (row.phase === "done" || row.phase === "exchanged") return false;
    const result = await this.database.query({
      sql: `UPDATE ${LOGIN_FLOW_TABLE} SET phase = 'issuing', exchange_hash = ? WHERE login_id = ? AND phase = 'callback_ready' AND expires_at > ? AND (exchange_hash = '' OR exchange_hash = ?) RETURNING login_id`,
      params: [exchange_hash, row.login_id, Date.now(), exchange_hash],
    });
    if (!result.rows.length) throw httpError(409, "OAuth login not ready or exchange in progress");
    return true;
  }

  /** 签发或保存失败可用原交换 ID 重试；已写入 done/exchanged 的结果不会被回退。 */
  async retry_oauth_exchange(login_id: string, exchange_id: string): Promise<void> {
    await this.database.query({
      sql: `UPDATE ${LOGIN_FLOW_TABLE} SET phase = 'callback_ready' WHERE login_id = ? AND phase = 'issuing' AND exchange_hash = ?`,
      params: [login_id, await digest_secret(exchange_id)],
    });
  }

  /** Require a same-origin browser mutation; non-browser clients never use cookie-only proofs. */
  private require_same_origin(request: Request): void {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw httpError(403, "same-origin browser request required");
  }

  /** Compare the browser cookie digest with the persisted binding. */
  private async require_browser(row: LoginFlowRow, request: Request): Promise<void> {
    const cookie_name = this.cookie_name(row.login_id, request);
    const value = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookie_name}=`))?.slice(cookie_name.length + 1) ?? "";
    if (!value || await digest_secret(value) !== row.browser_hash) throw httpError(403, "login browser binding mismatch");
  }

  /** HTTPS uses a host-only cookie; HTTP is restricted to local development origins. */
  private cookie_name(login_id: string, request: Request): string {
    const url = new URL(request.url);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw httpError(400, "HTTPS required for browser authorization");
    return `${url.protocol === "https:" ? "__Host-" : ""}dc_login_${login_id}`;
  }

  /** Short-lived, host-only, HttpOnly browser binding; SameSite=Lax permits OAuth GET callbacks. */
  private cookie(login_id: string, value: string, request: Request): string {
    return `${this.cookie_name(login_id, request)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=360${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
  }
}
