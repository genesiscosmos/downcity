/**
 * City HTTP 的浏览器来源边界：宿主声明精确 Origin，预检在 Agent 鉴权前结束。
 * 不启用跨域 Cookie，不改变 Bearer 授权，也不读取或缓冲流式响应正文。
 */
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

const allowed_methods = ["GET", "POST", "OPTIONS"];
const allowed_headers = ["authorization", "content-type"];

/** 只接受 HTTP/HTTPS Origin；拒绝通配、路径、凭据与不透明来源。 */
function normalize_origin(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.hostname.includes("*") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`City HTTP allowed_origins requires an HTTP/HTTPS origin: ${value}`);
  }
  return url.origin;
}

/** 精确来源白名单；无 Origin 的 SDK 请求保持原有授权路径。 */
export function create_city_cors(allowed_origins: readonly string[]): MiddlewareHandler {
  const origins = new Set(allowed_origins.map(normalize_origin));
  const middleware = cors({
    origin: origin => origins.has(origin) ? origin : undefined,
    allowMethods: allowed_methods,
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  });
  return async (context, next) => {
    const origin = context.req.header("Origin");
    if (!origin) return await next();
    // 同源请求无需跨域许可；反向代理应在入口正确传递请求的公开地址。
    if (origin === new URL(context.req.url).origin) return await next();
    if (!origins.has(origin)) {
      context.header("Vary", "Origin", { append: true });
      return context.json({ success: false, error: "Browser origin is not allowed" }, 403);
    }
    if (context.req.method === "OPTIONS") {
      const method = context.req.header("Access-Control-Request-Method");
      const headers = (context.req.header("Access-Control-Request-Headers") ?? "")
        .split(",").map(header => header.trim().toLowerCase()).filter(Boolean);
      if (!method || !allowed_methods.includes(method) || headers.some(header => !allowed_headers.includes(header))) {
        return context.json({ success: false, error: "CORS preflight is not allowed" }, 403);
      }
    }
    return await middleware(context, next);
  };
}
