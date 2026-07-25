/**
 * 密码哈希工具。
 *
 * 关键点（中文）
 * - V1 先使用 Node 内建 `scryptSync`，避免引入额外依赖。
 * - 存储格式固定为 `scrypt$<salt>$<hash>`，便于后续平滑升级。
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * 哈希密码。
 */
export function hashPassword(passwordInput: string): string {
  const password = String(passwordInput || "");
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

/**
 * 校验密码。
 */
export function verifyPassword(passwordInput: string, passwordHashInput: string): boolean {
  const password = String(passwordInput || "");
  const password_hash = String(passwordHashInput || "").trim();
  const parts = password_hash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = parts[1];
  const expectedHex = parts[2];
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

