/**
 * Task System paths and identifiers.
 *
 * 约定（中文）
 * - task root: `<Agent data>/task/`
 * - definition: `<Agent data>/task/<taskId>/task.md`
 * - run dir: `<Agent data>/task/<taskId>/<timestamp>/`
 *
 * 同时定义“task run session_id”格式，用于把 Agent 的 session 映射到 run 目录：
 * - `task-run:<taskId>:<timestamp>`
 */

import path from "node:path";

/**
 * taskId 允许字符：
 * - 首字符：任意语言字母/数字
 * - 后续：字母/数字/空格/下划线/连字符
 */
const TASK_ID_REGEXP = /^[\p{L}\p{N}][\p{L}\p{N}_\-\s]{0,63}$/u;

export function isValidTaskId(input: string): boolean {
  const id = String(input || "").trim();
  if (!id) return false;
  // 关键点（中文）：taskId 直接参与文件路径拼接，必须是安全的文件夹名。
  return TASK_ID_REGEXP.test(id);
}

/**
 * 从 title 派生 taskId。
 *
 * 关键点（中文）
 * - 目标：保证“title 与 taskId 同源”，避免随机 ID。
 * - 处理：移除路径危险字符与非常见标点，压缩空白，最终按 taskId 规则校验。
 */
export function deriveTaskIdFromTitle(title: string): string {
  const normalized = String(title || "")
    .normalize("NFKC")
    .replace(/[\\/:\u0000]/g, " ")
    .replace(/[^\p{L}\p{N}_\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
    .trim();

  if (!normalized) {
    throw new Error("Cannot derive taskId from title: title is empty after normalization.");
  }
  return normalizeTaskId(normalized);
}

export function normalizeTaskId(input: string): string {
  const id = String(input || "").trim();
  if (!isValidTaskId(id)) {
    throw new Error(
      `Invalid taskId: "${id}". Use a letter/number first, then letters/numbers/space/_/-, max 64 chars.`,
    );
  }
  return id;
}

export function getTaskRootDir(data_path: string): string {
  return path.join(String(data_path || "").trim(), "task");
}

export function getTaskDir(data_path: string, taskId: string): string {
  return path.join(getTaskRootDir(data_path), normalizeTaskId(taskId));
}

export function getTaskMdPath(data_path: string, taskId: string): string {
  return path.join(getTaskDir(data_path, taskId), "task.md");
}

export function formatTaskRunTimestamp(date: Date = new Date()): string {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  // 关键点（中文）：run 目录名统一使用 UTC，避免跨时区/DST 下时间排序歧义。
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1, 2);
  const dd = pad(date.getUTCDate(), 2);
  const hh = pad(date.getUTCHours(), 2);
  const mi = pad(date.getUTCMinutes(), 2);
  const ss = pad(date.getUTCSeconds(), 2);
  const ms = pad(date.getUTCMilliseconds(), 3);
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}-${ms}`;
}

export function getTaskRunDir(
  data_path: string,
  taskId: string,
  timestamp: string,
): string {
  const ts = String(timestamp || "").trim();
  if (!ts) throw new Error("timestamp is required");
  return path.join(getTaskDir(data_path, taskId), ts);
}

export function createTaskRunSessionId(taskId: string, timestamp: string): string {
  const id = normalizeTaskId(taskId);
  const ts = String(timestamp || "").trim();
  if (!ts) throw new Error("timestamp is required");
  return `task-run:${id}:${ts}`;
}

export function parseTaskRunSessionId(
  session_id: string,
): { taskId: string; timestamp: string } | null {
  const key = String(session_id || "").trim();
  if (!key) return null;
  const m = key.match(/^task-run:([^:]+):(.+)$/);
  if (!m) return null;
  const taskId = String(m[1] || "").trim();
  const timestamp = String(m[2] || "").trim();
  if (!taskId || !timestamp) return null;
  if (!isValidTaskId(taskId)) return null;
  return { taskId, timestamp };
}
