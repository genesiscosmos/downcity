/**
 * Login delivery state machine: independent claim proof, browser binding, explicit device
 * approval and atomic exchange with a bounded idempotent retry window. Secrets never enter URLs.
 */
import { httpError } from "@downcity/federation";
import type { ServiceDatabaseContext } from "@downcity/federation";
import { LOGIN_FLOW_TABLE, type LoginFlowRow } from "./login-schema.js";
import { randomToken } from "./utils.js";

/** SHA-256 digest for random bearer credentials. */
async function digest_secret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Bounded ephemeral login persistence and browser authorization. */
export class LoginFlow {
  constructor(private readonly database: ServiceDatabaseContext) {}

  /** Erase expired credentials, including retained exchange responses. */
  async cleanup(): Promise<void> {
    await this.database.query({
      sql: `DELETE FROM ${LOGIN_FLOW_TABLE} WHERE expires_at <= ? OR (phase = 'exchanged' AND retry_until <= ?)`,
      params: [Date.now(), Date.now()],
    });
  }

  /** Create a new flow; only the JSON response exposes the claim secret and device code. */
  async start(bureau_id: string, provider: string, client_type: unknown, request: Request) {
    if (client_type !== "web" && client_type !== "cli" && client_type !== "desktop" && client_type !== "device") {
      throw httpError(400, "explicit client_type web, cli, desktop or device required");
    }
    if (client_type === "web") this.require_same_origin(request);
    await this.cleanup();
    const login_id = randomToken(24);
    const login_secret = randomToken(32);
    const browser_secret = randomToken(32);
    const needs_code = client_type !== "web" && provider !== "email" && provider !== "local";
    const code_bytes = crypto.getRandomValues(new Uint8Array(8));
    const user_code = Array.from(code_bytes, (byte) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[byte % 32]).join("");
    await this.database.query({
      sql: `INSERT INTO ${LOGIN_FLOW_TABLE} (login_id, secret_hash, bureau_id, provider, client_type, oauth_state, browser_hash, code_hash, csrf_hash, phase, user_id, user_token, exchange_hash, retry_until, attempts, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 'created', '', '', '', 0, 0, ?)`,
      params: [login_id, await digest_secret(login_secret), bureau_id, provider, client_type,
        randomToken(32), client_type === "web" ? await digest_secret(browser_secret) : "",
        needs_code ? await digest_secret(user_code) : "", Date.now() + 300_000],
    });
    return {
      login_id, login_secret,
      ...(needs_code ? { user_code } : {}),
      cookie: client_type === "web" ? this.cookie(login_id, browser_secret, request) : undefined,
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

  /** Authenticate the initiating client; web flows additionally require their browser cookie. */
  async claim(login_id: string, login_secret: string, request: Request): Promise<LoginFlowRow> {
    const row = await this.read(login_id);
    if (!login_secret || await digest_secret(login_secret) !== row.secret_hash) {
      throw httpError(403, "invalid login proof");
    }
    if (row.client_type === "web") {
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
      sql: `UPDATE ${LOGIN_FLOW_TABLE} SET phase = 'done', user_token = ?, oauth_state = ?, csrf_hash = '', code_hash = '' WHERE login_id = ? AND phase = ? AND expires_at > ? RETURNING login_id`,
      params: [user_token, randomToken(32), login_id, phase, Date.now()],
    });
    if (!result.rows.length) throw httpError(409, "login state changed; restart login");
  }

  /** Atomically claim one exchange id; retries with the same id recover the original response. */
  async exchange(row: LoginFlowRow, exchange_id: string) {
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(exchange_id)) throw httpError(400, "random exchange_id required (20-128 URL-safe characters)");
    const exchange_hash = await digest_secret(exchange_id);
    await this.database.query({
      sql: `UPDATE ${LOGIN_FLOW_TABLE} SET phase = 'exchanged', exchange_hash = ?, retry_until = ?, expires_at = ?, user_id = '' WHERE login_id = ? AND phase = 'done' AND expires_at > ?`,
      params: [exchange_hash, Date.now() + 60_000, Date.now() + 60_000, row.login_id, Date.now()],
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
    let browser_secret = "";
    if (row.client_type === "web") await this.require_browser(row, request);
    else browser_secret = randomToken(32);
    const result = await this.database.query({
      sql: `UPDATE ${LOGIN_FLOW_TABLE} SET phase = 'authorizing', browser_hash = ? WHERE login_id = ? AND phase = 'created' AND expires_at > ? RETURNING login_id`,
      params: [browser_secret ? await digest_secret(browser_secret) : row.browser_hash, login_id, Date.now()],
    });
    if (!result.rows.length) throw httpError(409, "authorization already started; restart login");
    const headers = new Headers({ location: build_url(row.oauth_state), "cache-control": "no-store", "referrer-policy": "no-referrer" });
    if (browser_secret) headers.set("set-cookie", this.cookie(login_id, browser_secret, request));
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

  /** Store identity pending consent; a CSRF nonce is delivered only in the bound browser form. */
  async authenticated(row: LoginFlowRow, user_id: string): Promise<string> {
    const csrf = randomToken(32);
    await this.database.query({
      sql: `UPDATE ${LOGIN_FLOW_TABLE} SET phase = 'confirming', user_id = ?, csrf_hash = ? WHERE login_id = ? AND phase = 'authenticating' AND expires_at > ?`,
      params: [user_id, await digest_secret(csrf), row.login_id, Date.now()],
    });
    return csrf;
  }

  /** Validate origin, browser, CSRF and the external device code before issuing any token. */
  async confirm(request: Request): Promise<LoginFlowRow> {
    this.require_same_origin(request);
    const form = await request.formData();
    const row = await this.read(String(form.get("login_id") ?? ""));
    await this.require_browser(row, request);
    if (row.phase !== "confirming" || row.attempts >= 5
      || await digest_secret(String(form.get("csrf") ?? "")) !== row.csrf_hash) {
      throw httpError(403, "invalid or expired authorization confirmation");
    }
    const attempt = await this.database.query({
      sql: `UPDATE ${LOGIN_FLOW_TABLE} SET attempts = attempts + 1 WHERE login_id = ? AND phase = 'confirming' AND attempts < 5 RETURNING login_id`, params: [row.login_id],
    });
    if (!attempt.rows.length) throw httpError(403, "confirmation attempts exceeded");
    const code = String(form.get("user_code") ?? "").replace(/[\s-]/g, "").toUpperCase();
    if (row.client_type !== "web" && await digest_secret(code) !== row.code_hash) {
      throw httpError(403, "device code does not match; return to the original client and restart login");
    }
    if (!await this.advance(row.login_id, "confirming", "issuing")) throw httpError(409, "authorization already confirmed");
    return row;
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
