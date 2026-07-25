/**
 * ID 生成工具。
 *
 * 关键点（中文）
 * - 提供跨层通用的唯一 ID 生成能力。
 * - 放在 `utils`，避免 `core -> main` 反向依赖。
 */

import { nanoid } from "nanoid";

export function generate_id(): string {
  return nanoid(16);
}
