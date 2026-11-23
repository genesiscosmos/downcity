/**
 * OAuth 产品回调与 PKCE 参数校验。
 * 网站只能回到宿主明确配置的精确可信产品 callback；CLI/Desktop 只能回到
 * 127.0.0.1 临时端口。Provider state 与产品 callback state 分别绑定两次浏览器跳转。
 */
import { httpError } from "@downcity/downtown";
import type { AccountsLoginStartRequest } from "./types.js";

/** 校验全部 OAuth 客户端的回调目标；空白名单拒绝网站回调，不从请求推导信任。 */
export function oauth_login_parameters(input: Partial<AccountsLoginStartRequest>, trusted_web_callbacks: readonly string[] = []) {
  let url: URL;
  try { url = new URL(String(input.redirect_uri ?? "")); }
  catch { throw httpError(400, "OAuth redirect_uri required"); }
  if (url.username || url.password || url.search || url.hash || url.href !== input.redirect_uri) {
    throw httpError(400, "canonical OAuth callback URL required");
  }
  if (input.client_type === "web") {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local))
      || !trusted_web_callbacks.includes(url.href)) {
      throw httpError(400, "redirect_uri must exactly match a trusted product callback");
    }
  } else if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
    || Number(url.port) < 1024 || url.pathname === "/") {
    throw httpError(400, "loopback redirect_uri must use 127.0.0.1 with an unprivileged port and callback path");
  }
  const state = String(input.state ?? "");
  const code_challenge = String(input.code_challenge ?? "");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(code_challenge)
    || input.code_challenge_method !== "S256") throw httpError(400, "random state and S256 PKCE challenge required");
  return { redirect_uri: url.href, callback_state: state, code_challenge };
}

/** 验证 RFC 7636 verifier，并计算 S256 base64url challenge。 */
export async function oauth_code_challenge(code_verifier: string): Promise<string> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(code_verifier)) throw httpError(403, "invalid OAuth PKCE verifier");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code_verifier)));
  return btoa(String.fromCharCode(...digest)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
