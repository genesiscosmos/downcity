/**
 * 本机 OAuth 回调结果页：复用官网的中性色与留白，独立提供响应式布局和系统深色模式。
 * 页面仅使用固定文案与内联 SVG，不加载外部资源、不执行脚本，也不回显回调参数。
 * CSP 的 SHA-256 由实际 CSS 生成，允许本页样式，同时保持其他资源默认禁用。
 */
import { createHash } from "node:crypto";

const page_styles = `
:root {
  color-scheme: light dark;
  --paper: #fafafa;
  --ink: #232323;
  --muted: #6b6b6b;
  --success: #28734d;
  --success-surface: #edf5ef;
  --error: #a34436;
  --error-surface: #faeeeb;
  font-family: Arial, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  min-height: 100svh;
  display: grid;
  place-items: center;
  padding: 40px 24px;
  background: var(--paper);
  color: var(--ink);
}
main { width: 100%; max-width: 400px; text-align: center; overflow-wrap: break-word; }
.brand { margin: 0 0 36px; font-size: 15px; font-weight: 600; letter-spacing: -0.5px; }
.status-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin: 0 auto 24px;
  border-radius: 50%;
  background: var(--success-surface);
  color: var(--success);
}
.status-icon svg { width: 24px; height: 24px; }
.status-error { background: var(--error-surface); color: var(--error); }
h1 { margin: 0; font-size: 26px; font-weight: 400; line-height: 1.3; letter-spacing: -0.03em; }
.description { margin: 14px 0 0; color: var(--muted); font-size: 14px; line-height: 1.8; }
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #171717;
    --ink: #ececec;
    --muted: #a3a3a3;
    --success: #8fc9a5;
    --success-surface: #223129;
    --error: #e6a094;
    --error-surface: #382623;
  }
}
@media (max-width: 480px) {
  h1 { font-size: 24px; }
  .brand { margin-bottom: 30px; }
}
`;

/** 仅放行本模块生成的样式；不允许外部资源、脚本、表单提交或嵌入框架。 */
export const login_callback_content_security_policy = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(page_styles).digest("base64")}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;

const page_messages = {
  en: {
    received: {
      title: "Authorization received",
      description: "Return to Downcity to continue.<br>You can close this window.",
    },
    invalid: {
      title: "Invalid login callback",
      description: "Return to Downcity and start signing in again.<br>You can close this window.",
    },
    expired: {
      title: "Login callback expired",
      description: "Return to Downcity and start signing in again.<br>You can close this window.",
    },
  },
  zh: {
    received: {
      title: "授权已接收",
      description: "请返回 Downcity 继续。<br>你可以关闭此窗口。",
    },
    invalid: {
      title: "登录回调无效",
      description: "请返回 Downcity 重新发起登录。<br>你可以关闭此窗口。",
    },
    expired: {
      title: "登录回调已过期",
      description: "请返回 Downcity 重新发起登录。<br>你可以关闭此窗口。",
    },
  },
};

/** 按浏览器语言优先级选择中英文；未匹配到支持的语言时使用英文。 */
function select_page_language(accept_language: string): "en" | "zh" {
  const preferences = accept_language.split(",").map((entry) => {
    const [language = "", ...parameters] = entry.trim().toLowerCase().split(";");
    const quality_parameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const quality = quality_parameter === undefined ? 1 : Number(quality_parameter.trim().slice(2));
    return { language, quality };
  }).filter(({ quality }) => Number.isFinite(quality) && quality > 0 && quality <= 1)
    .sort((left, right) => right.quality - left.quality);
  for (const { language } of preferences) {
    if (/^zh(?:-|$)/.test(language)) return "zh";
    if (/^en(?:-|$)/.test(language)) return "en";
  }
  return "en";
}

/** 渲染固定的接收、无效或过期状态；请求头仅用于选择语言，不进入 HTML。 */
export function render_login_callback_page(
  state: "received" | "invalid" | "expired",
  accept_language = "",
): string {
  const language = select_page_language(accept_language);
  const { title, description } = page_messages[language][state];
  const received = state === "received";
  const icon = received ? '<path d="m5 12 4 4 10-10" />' : '<path d="M12 7v6m0 4h.01" />';
  return `<!doctype html>
<html lang="${language === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title} · Downcity</title>
<style>${page_styles}</style>
</head>
<body>
<main aria-labelledby="page-title">
<p class="brand">Downcity</p>
<div class="status-icon${received ? "" : " status-error"}" aria-hidden="true">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
</div>
<h1 id="page-title">${title}</h1>
<p class="description">${description}</p>
</main>
</body>
</html>`;
}
