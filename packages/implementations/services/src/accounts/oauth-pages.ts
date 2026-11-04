/**
 * Accounts OAuth 回调结果页面。
 *
 * 关键说明（中文）
 * - OAuth callback 面向浏览器，不返回 JSON。
 * - 认证成功直接返回产品 callback；这里只呈现失败信息。
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

/** Restrict result pages to local styles, prevent framing and suppress callback URL referrers. */
const oauth_page_headers = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
};

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
