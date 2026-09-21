/**
 * City 内部 ID 生成工具。
 *
 * 关键点（中文）
 * - ID 是不透明随机串，没有跨包语义，因此不进入共享定义层，只在本包内统一一份。
 * - Shell 与 Power 共用这里，避免各自复制实现。
 */

import { randomBytes } from "node:crypto";

/** 生成短随机 ID。 */
export function generate_id(): string {
  return randomBytes(10).toString("base64url");
}
