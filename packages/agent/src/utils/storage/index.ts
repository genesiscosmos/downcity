/**
 * 存储读写工具模块。
 *
 * 职责说明：
 * 1. 提供目录创建、JSON 读写等基础能力。
 * 2. 统一封装 fs-extra 的常用行为，减少业务层重复判断。
 */
import fs from "fs-extra";
import type { JsonValue } from "@/types/common/Json.js";

export async function ensure_dir(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function save_json(filePath: string, data: JsonValue | object): Promise<void> {
  await fs.writeJson(filePath, data, { spaces: 2 });
}
