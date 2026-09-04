/**
 * Bearer Token 工具。
 *
 * 关键点（中文）
 * - 明文 token 只在签发时生成一次。
 * - 存储层始终只保存哈希值，避免数据库泄漏时直接暴露访问凭证。
 */

import { createHash, randomBytes } from "node:crypto";

/**
 * 生成新的明文 token。
 */
export function generateAccessToken(): string {
  return `dc_${randomBytes(24).toString("hex")}`;
}

/**
 * 计算 token 哈希。
 */
export function hashAccessToken(tokenInput: string): string {
  return createHash("sha256").update(String(tokenInput || ""), "utf8").digest("hex");
}

/**
 * 从 Authorization 头提取 Bearer Token。
 */
export function extractBearerToken(headerValue: string | undefined): string | null {
  const header = String(headerValue || "").trim();
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match?.[1]) return null;
  const token = match[1].trim();
  return token || null;
}

