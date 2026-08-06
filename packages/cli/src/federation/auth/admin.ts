/**
 * Admin 鉴权模块。
 *
 * 管理员密码只发送到 Federation 登录端点，后续管理请求使用有期限 Session Token。
 */

import { type AdminSession, type ServerProfile } from "@/federation/core/session.js";
import { showError } from "@/federation/core/ui.js";
import { t } from "@/shared/CliLocale.js";

export async function adminAuth(server: ServerProfile): Promise<AdminSession | undefined> {
  const session_token = String(server.admin_session_token ?? "").trim();
  const admin_id = String(server.admin_id ?? "").trim();
  const expires_at = String(server.admin_session_expires_at ?? "").trim();
  if (!session_token || !admin_id || !expires_at || Date.parse(expires_at) <= Date.now()) {
    showError(t({
      zh: "当前 Federation 需要管理员登录。",
      en: "Administrator login is required for the current Federation.",
    }));
    return undefined;
  }

  return {
    base_url: server.base_url,
    session_token,
    admin_id,
    expires_at,
  };
}

/** 使用管理员 ID 和密码登录 Federation。 */
export async function login_federation_admin(input: {
  /** Federation HTTP 基础 URL。 */
  base_url: string;
  /** 管理员登录 ID。 */
  admin_id: string;
  /** 管理员明文密码，仅用于本次登录请求。 */
  password: string;
}): Promise<AdminSession> {
  const base_url = input.base_url.replace(/\/+$/gu, "");
  const response = await fetch(`${base_url}/v1/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ admin_id: input.admin_id.trim(), password: input.password }),
  });
  const body = await response.json().catch(() => ({})) as {
    admin_id?: unknown;
    session_token?: unknown;
    expires_at?: unknown;
    error?: { message?: unknown };
  };
  if (!response.ok) {
    const message = typeof body.error?.message === "string"
      ? body.error.message
      : `Administrator login failed: HTTP ${response.status}`;
    throw new Error(message);
  }
  if (
    typeof body.admin_id !== "string"
    || typeof body.session_token !== "string"
    || typeof body.expires_at !== "string"
  ) {
    throw new Error("Federation returned an invalid administrator session");
  }
  return {
    base_url,
    admin_id: body.admin_id,
    session_token: body.session_token,
    expires_at: body.expires_at,
  };
}
