/**
 * Federation 管理员密码摘要模块。
 *
 * 只依赖 Web Crypto，保证 Node.js、Cloudflare Workers 与浏览器兼容 Runtime 使用相同
 * 的 PBKDF2-HMAC-SHA256 格式。调用方只能持久化返回的编码摘要，不能持久化明文密码。
 */

import {
  base64UrlDecodeBytes,
  base64UrlEncodeBytes,
  randomSecret,
  timingSafeEqualBytes,
} from "../../utils/helpers.js";

const PASSWORD_ALGORITHM = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_SALT_BYTES = 24;
const PASSWORD_HASH_BYTES = 32;

/** 为管理员明文密码创建带随机盐值的编码摘要。 */
export async function create_federation_admin_password_hash(password: string): Promise<string> {
  const normalized_password = normalize_password(password);
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const digest = await derive_password(normalized_password, salt, PASSWORD_ITERATIONS);
  return [
    PASSWORD_ALGORITHM,
    String(PASSWORD_ITERATIONS),
    base64UrlEncodeBytes(salt),
    base64UrlEncodeBytes(digest),
  ].join("$");
}

/** 校验管理员明文密码与已编码摘要是否匹配。 */
export async function verify_federation_admin_password(
  password: string,
  encoded_hash: string,
): Promise<boolean> {
  const parts = String(encoded_hash ?? "").split("$");
  if (parts.length !== 4 || parts[0] !== PASSWORD_ALGORITHM) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
  try {
    const salt = base64UrlDecodeBytes(parts[2]);
    const expected = base64UrlDecodeBytes(parts[3]);
    const actual = await derive_password(normalize_password(password), salt, iterations);
    return timingSafeEqualBytes(actual, expected);
  } catch {
    return false;
  }
}

/** 生成首次部署或恢复时一次性展示的高熵管理员凭证。 */
export function create_federation_admin_credentials(): { admin_id: string; password: string } {
  return {
    admin_id: `admin_${randomSecret(9)}`,
    password: `fed_${randomSecret(24)}`,
  };
}

/** 使用 PBKDF2-HMAC-SHA256 派生固定长度密码摘要。 */
async function derive_password(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const password_salt = new Uint8Array(salt.byteLength);
  password_salt.set(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: password_salt,
    iterations,
  }, key, PASSWORD_HASH_BYTES * 8);
  return new Uint8Array(bits);
}

/** 拒绝空密码并保留密码原始字节语义。 */
function normalize_password(password: string): string {
  if (typeof password !== "string" || !password) throw new TypeError("Administrator password is required");
  if (new TextEncoder().encode(password).byteLength > 1024) {
    throw new TypeError("Administrator password is too long");
  }
  return password;
}
