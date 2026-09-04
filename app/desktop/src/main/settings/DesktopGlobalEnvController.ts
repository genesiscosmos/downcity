/** Desktop 用户级 Global Env 文件控制器。 */

import fs from "node:fs/promises";
import path from "node:path";
import { get_local_env_path } from "@downcity/city/local";
import type { DesktopLocalData } from "../agent/DesktopLocalData.js";

/** 原样读取和保存 `~/.downcity/.env`。 */
export class DesktopGlobalEnvController {
  constructor(private readonly data: DesktopLocalData) {}

  async list(): Promise<string> {
    const file_path = get_local_env_path(this.data.root_path);
    try {
      const raw = await fs.readFile(file_path, "utf8");
      return raw;
    } catch {
      return "";
    }
  }

  async update(raw: unknown): Promise<string> {
    const file_path = get_local_env_path(this.data.root_path);
    await fs.mkdir(path.dirname(file_path), { recursive: true, mode: 0o700 });
    const normalized = normalize_env_text(raw).replace(/\r\n?/gu, "\n");
    const text = normalized ? `${normalized.replace(/\n*$/u, "")}\n` : "";
    const temp_path = `${file_path}.${process.pid}.tmp`;
    await fs.writeFile(temp_path, text, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp_path, file_path);
    await fs.chmod(file_path, 0o600);
    return text;
  }
}

/** 兼容旧版 key/value IPC 输入，避免被写成 `[object Object]`。 */
function normalize_env_text(input: unknown): string {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  return Object.entries(input)
    .map(([key, value]) => `${key}=${String(value ?? "")}`)
    .join("\n");
}
