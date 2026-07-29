/**
 * City Env 文件存储模块。
 *
 * 职责说明（中文）
 * - 读取、设置与删除普通 `.env` 文件中的键值。
 * - 修改时保留不相关的注释、空行与配置，并消除目标 key 的重复声明。
 * - 使用同目录临时文件加原子替换，避免进程中断留下半写文件。
 */

import dotenv from "dotenv";
import fs from "fs-extra";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** 校验并规范化 Env key。 */
export function normalize_env_key(value: string): string {
  const key = String(value || "").trim().toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(key)) {
    throw new Error(`Invalid env key: ${value}`);
  }
  return key;
}

/** 把 Env value 格式化成 dotenv 可安全解析的文本。 */
export function format_env_value(value: string): string {
  const text = String(value ?? "");
  if (!text) return "";
  if (/^[A-Za-z0-9_./:@+-]+$/u.test(text)) return text;
  return `"${text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/"/g, "\\\"")}"`;
}

/** 读取 Env 文件；文件不存在时返回空映射。 */
export async function read_env_file(file_path: string): Promise<Record<string, string>> {
  if (!(await fs.pathExists(file_path))) return {};
  const content = await fs.readFile(file_path, "utf8");
  return normalize_env_map(dotenv.parse(content));
}

/** 同步读取 Env 文件；文件不存在或无法解析时返回空映射。 */
export function read_env_file_sync(file_path: string): Record<string, string> {
  try {
    if (!fs.existsSync(file_path)) return {};
    return normalize_env_map(dotenv.parse(fs.readFileSync(file_path, "utf8")));
  } catch {
    return {};
  }
}

/** 设置单个 Env key，并保留文件内其他内容。 */
export async function set_env_file_value(input: {
  /** 目标 `.env` 文件绝对路径。 */
  file_path: string;
  /** 环境变量 key。 */
  key: string;
  /** 环境变量 value。 */
  value: string;
  /** 文件权限；全局 Env 使用 `0o600`。 */
  mode?: number;
}): Promise<void> {
  const key = normalize_env_key(input.key);
  const existing = await read_env_text(input.file_path);
  const matcher = build_key_matcher(key);
  const lines = existing.split(/\r?\n/u);
  const next_lines: string[] = [];
  let replaced = false;
  for (const line of lines) {
    if (!matcher.test(line)) {
      next_lines.push(line);
      continue;
    }
    if (!replaced) {
      next_lines.push(`${key}=${format_env_value(input.value)}`);
      replaced = true;
    }
  }
  if (!replaced) {
    while (next_lines.length > 0 && next_lines[next_lines.length - 1] === "") next_lines.pop();
    if (next_lines.length > 0) next_lines.push("");
    next_lines.push(`${key}=${format_env_value(input.value)}`);
  }
  await write_env_text(input.file_path, `${next_lines.join("\n").replace(/\n+$/u, "")}\n`, input.mode);
}

/** 删除单个 Env key；不存在时保持幂等。 */
export async function delete_env_file_value(input: {
  /** 目标 `.env` 文件绝对路径。 */
  file_path: string;
  /** 环境变量 key。 */
  key: string;
  /** 文件权限；全局 Env 使用 `0o600`。 */
  mode?: number;
}): Promise<boolean> {
  const key = normalize_env_key(input.key);
  if (!(await fs.pathExists(input.file_path))) return false;
  const existing = await read_env_text(input.file_path);
  const matcher = build_key_matcher(key);
  const lines = existing.split(/\r?\n/u);
  const next_lines = lines.filter((line) => !matcher.test(line));
  if (next_lines.length === lines.length) return false;
  const next = next_lines.join("\n").replace(/\n{3,}/gu, "\n\n").replace(/\n+$/u, "");
  await write_env_text(input.file_path, next ? `${next}\n` : "", input.mode);
  return true;
}

/** 把未知 Env 映射规范化为字符串映射。 */
function normalize_env_map(input: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [raw_key, raw_value] of Object.entries(input)) {
    const key = String(raw_key || "").trim();
    if (!key) continue;
    result[key] = String(raw_value ?? "");
  }
  return result;
}

/** 构造只匹配目标 key 声明行的正则。 */
function build_key_matcher(key: string): RegExp {
  return new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`, "u");
}

/** 读取原始 Env 文本。 */
async function read_env_text(file_path: string): Promise<string> {
  return await fs.pathExists(file_path) ? await fs.readFile(file_path, "utf8") : "";
}

/** 使用同目录临时文件原子替换 Env 文件。 */
async function write_env_text(file_path: string, content: string, mode?: number): Promise<void> {
  const directory = path.dirname(file_path);
  await fs.ensureDir(directory);
  const temporary_path = path.join(directory, `.${path.basename(file_path)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary_path, content, { encoding: "utf8", ...(mode ? { mode } : {}) });
    await fs.rename(temporary_path, file_path);
    if (mode) await fs.chmod(file_path, mode);
  } finally {
    await fs.remove(temporary_path);
  }
}
