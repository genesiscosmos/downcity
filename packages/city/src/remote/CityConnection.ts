/**
 * City 连接码的跨平台编解码：格式标识与 UTF-8 base64url，不依赖 Node 或外部服务。
 * 编码仅封装地址与凭据，不提供加密、身份绑定或网络隧道；City 负责权限、到期与撤销。
 */
import type { CityConnection } from "@/types/remote/CityConnection.js";

const prefix = "citycode:";
const max_code_length = 32768;

/** 仅验证数据形状，错误消息始终不回显包含凭据的输入。 */
function normalize_connection(input: unknown): CityConnection {
  if (!input || typeof input !== "object" || !("url" in input) || !("token" in input)
    || typeof input.url !== "string" || typeof input.token !== "string") throw new Error("Invalid City connection information");
  let url: URL;
  try { url = new URL(input.url.trim()); } catch { throw new Error("Invalid City connection address"); }
  if (url.href.length > 8192 || !/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.hostname.includes("*")) {
    throw new Error("City connection requires an HTTP/HTTPS address without credentials, query or fragment");
  }
  const token = input.token.trim();
  if (!token || token.length > 8192 || /\s/.test(token)) throw new Error("Invalid City connection credential");
  return { url: url.toString().replace(/\/+$/, ""), token };
}

/** 将本次独立凭据封装为可复制的连接码，不持久化或发送任何数据。 */
export function encode_city_connection(input: CityConnection): string {
  const connection = normalize_connection(input);
  const bytes = new TextEncoder().encode(JSON.stringify(connection));
  const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const code = `${prefix}${encoded}`;
  if (code.length > max_code_length) throw new Error("City connection information is too long");
  return code;
}

/** 本地解析连接码，严格拒绝损坏、不支持的前缀和无效地址，不回显连接码内容。 */
export function decode_city_connection(value: string): CityConnection {
  const code = value.trim();
  if (code.length > max_code_length || !code.startsWith(prefix)) throw new Error("Invalid or unsupported City connection code");
  const encoded = code.slice(prefix.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) throw new Error("Invalid City connection code");
  let input: unknown;
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { throw new Error("Invalid City connection code"); }
  return normalize_connection(input);
}
