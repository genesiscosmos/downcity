/**
 * Accounts OAuth 回调结果页面。
 *
 * 关键说明（中文）
 * - OAuth callback 面向浏览器，不返回 JSON。
 * - 认证后的确认页只展示可信 Provider 身份和注册目标；Token 由发起端独立交换。
 */

/**
 * 创建 OAuth 失败响应。
 */
export function oauthErrorResponse(error: string, status = 400): Response {
  return new Response(OAUTH_ERROR_HTML.replace("{{ERROR}}", escapeHTML(error)), {
    status,
    headers: oauth_page_headers,
  });
}

/**
 * 创建 OAuth 成功响应。
 */
export function oauthSuccessResponse(): Response {
  return new Response(OAUTH_SUCCESS_HTML, {
    status: 200,
    headers: oauth_page_headers,
  });
}

/** Restrict result pages to local styles, prevent framing and suppress callback URL referrers. */
const oauth_page_headers = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
};

/** Render consent using only server-selected provider identity and registered Bureau ID. */
export function oauth_confirmation_response(
  login_id: string,
  csrf: string,
  provider: string,
  identity: string,
  bureau_id: string,
  client_type: string,
): Response {
  const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escapeHTML(value)}">`;
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Authorize Downcity</title>
<body><main><h1>Authorize Downcity ${escapeHTML(client_type)}</h1>
<p>Signed in through ${escapeHTML(provider)} as ${escapeHTML(identity)}.</p>
<p>Authorize access to registered Bureau: <strong>${escapeHTML(bureau_id)}</strong></p>
<p>Only approve a login you started. Never enter a code sent by another person.</p>
<form method="post" action="/v1/accounts/oauth/confirm">${hidden("login_id", login_id)}${hidden("csrf", csrf)}
${client_type === "web" ? "" : '<label>Enter the code displayed by your original Downcity client <input name="user_code" required autocomplete="off" maxlength="16"></label>'}
<button type="submit">Authorize this login</button></form></main></body></html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * 转义 HTML。
 */
function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * OAuth 登录失败页面。
 */
const OAUTH_ERROR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Login Failed - Downcity</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         display: flex; justify-content: center; align-items: center;
         min-height: 100vh; margin: 0; background: #0a0a0a; color: #e0e0e0; }
  .box { text-align: center; padding: 2rem; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; color: #ff7c7c; }
  p { color: #888; font-size: 0.9rem; }
</style>
</head>
<body>
<div class="box">
  <h1>Login Failed</h1>
  <p>Error: {{ERROR}}</p>
</div>
</body>
</html>`;

/**
 * OAuth 登录成功页面。
 */
const OAUTH_SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Login Successful - Downcity</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         display: flex; justify-content: center; align-items: center;
         min-height: 100vh; margin: 0; background: #0a0a0a; color: #e0e0e0; }
  .box { text-align: center; padding: 2rem; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; color: #7cff7c; }
  p { color: #888; font-size: 0.9rem; }
</style>
</head>
<body>
<div class="box">
  <h1>Login Successful</h1>
  <p>Authorization confirmed. Close this window and return to the client that started this login.</p>
</div>
</body>
</html>`;
