/**
 * 运行时工具模块。
 *
 * 提供 CLI 参数解析、URL 规范化等基础设施。
 */

// ============================================================
// 常量
// ============================================================

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 43127;
// ============================================================
// CLI 参数解析
// ============================================================

export function parseArgs(argv: string[]) {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) { positionals.push(token); continue; }

    const key = token.slice(2).replace(/-([a-z])/g, (_, l: string) => l.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) { options[key] = true; continue; }
    options[key] = next;
    index += 1;
  }
  return { command: positionals[0] ?? "", options };
}

// ============================================================
// URL 规范化
// ============================================================

export function normalizeBaseUrl(baseUrl: string): string {
  const raw = String(baseUrl).trim();
  if (!raw) {
    throw new Error("City server URL is required.");
  }

  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//iu.test(raw);
  const withProtocol = hasProtocol ? raw : `${defaultProtocol(raw)}://${raw}`;
  const url = new URL(withProtocol);

  if (!url.port && isLocalOrIp(url.hostname)) url.port = String(DEFAULT_PORT);
  if (!url.pathname || url.pathname === "/") url.pathname = "/";
  return url.toString().replace(/\/+$/, "");
}

// ============================================================
// 内部辅助
// ============================================================

function defaultProtocol(value: string): "http" | "https" {
  const host = value.split("/")[0] ?? "";
  return (isLocalOrIp(host.split(":")[0] ?? "") || host.includes(":")) ? "http" : "https";
}

function isLocalOrIp(value: string): boolean {
  const host = value.replace(/^\[/u, "").replace(/\]$/u, "");
  return host === "localhost" || isIpv4Host(host) || host.includes(":");
}

function isIpv4Host(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((p) => /^\d+$/u.test(p) && Number(p) <= 255);
}
