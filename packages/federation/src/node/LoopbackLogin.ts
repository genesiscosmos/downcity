/**
 * CLI/Desktop OAuth 的 Node 专用临时 loopback 接收器；跨平台主入口不导入此模块。
 * 每次登录独占 127.0.0.1 随机端口、随机路径、state 与 PKCE verifier；只接受一次
 * 匹配的浏览器回调。接收器不交换 Token，也不持久化账户，由登录事务负责其生命周期。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { LoopbackLoginCallback } from "./types/LoopbackLogin.js";
export type { LoopbackLoginCallback } from "./types/LoopbackLogin.js";

/** 创建已经开始监听的独立接收器；监听失败时拒绝开始登录。 */
export async function create_loopback_login_callback(ttl_ms: number): Promise<LoopbackLoginCallback> {
  if (!Number.isFinite(ttl_ms) || ttl_ms <= 0 || ttl_ms > 300_000) throw new TypeError("Login callback TTL must be within five minutes");
  const state = randomBytes(32).toString("base64url");
  const code_verifier = randomBytes(32).toString("base64url");
  const code_challenge = createHash("sha256").update(code_verifier).digest("base64url");
  const callback_path = `/oauth/callback/${randomBytes(24).toString("base64url")}`;
  let redirect_uri = "";
  let authorization_code: string | undefined;
  let error: Error | undefined;
  let closed = false;
  let expiry_timer: ReturnType<typeof setTimeout> | undefined;
  const server = createServer(handle_request);
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.maxHeadersCount = 30;

  function close(): void {
    if (closed) return;
    closed = true;
    clearTimeout(expiry_timer);
    server.close();
    server.closeAllConnections();
  }

  function respond(response: ServerResponse, status: number, message: string): void {
    response.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      "x-content-type-options": "nosniff",
      connection: "close",
    });
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Downcity</title><h1>${message}</h1><p>You can close this window and return to Downcity.</p></html>`);
  }

  function handle_request(request: IncomingMessage, response: ServerResponse): void {
    // 不使用客户端提供的 Host 构建可信地址，也不接受绝对形式 URL、重复参数或额外字段。
    if (closed || authorization_code || !redirect_uri) return respond(response, 410, "Login callback expired");
    const expected_url = new URL(redirect_uri);
    const raw_url = request.url ?? "";
    if (request.method !== "GET" || request.headers.host !== expected_url.host
      || !raw_url.startsWith(`${callback_path}?`) || raw_url.length > 2_048) {
      return respond(response, 400, "Invalid login callback");
    }
    let url: URL;
    try { url = new URL(raw_url, expected_url.origin); }
    catch { return respond(response, 400, "Invalid login callback"); }
    const codes = url.searchParams.getAll("code");
    const states = url.searchParams.getAll("state");
    const received_state = Buffer.from(states[0] ?? "");
    const expected_state = Buffer.from(state);
    if (url.origin !== expected_url.origin || url.pathname !== callback_path || url.hash
      || codes.length !== 1 || states.length !== 1 || [...url.searchParams.keys()].length !== 2
      || !/^[A-Za-z0-9_-]{20,128}$/.test(codes[0] ?? "")
      || received_state.length !== expected_state.length || !timingSafeEqual(received_state, expected_state)) {
      return respond(response, 400, "Invalid login callback");
    }
    authorization_code = codes[0];
    // 响应送出后再释放连接；本机接收成功不等于账户已经保存。
    response.once("finish", close);
    response.once("close", close);
    respond(response, 200, "Authorization received");
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  }).catch((reason: unknown) => {
    close();
    throw reason;
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    close();
    throw new Error("Unable to open local login callback");
  }
  redirect_uri = `http://127.0.0.1:${address.port}${callback_path}`;
  server.on("error", () => { error = new Error("Local login callback failed"); close(); });
  expiry_timer = setTimeout(() => { error = new Error("Local login callback expired"); close(); }, ttl_ms);
  expiry_timer.unref();
  return {
    redirect_uri, state, code_verifier, code_challenge,
    get authorization_code() { return authorization_code; },
    get error() { return error; },
    close,
  };
}
