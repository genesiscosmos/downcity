/**
 * Shell 内部 ID 生成工具。
 *
 * 关键点（中文）
 * - shell 包不依赖 agent internal utils，因此在本包内保留一个轻量实现。
 */

import { randomBytes } from "node:crypto";

/**
 * 生成短随机 ID。
 */
export function generateId(): string {
  return randomBytes(10).toString("base64url");
}
