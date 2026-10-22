/**
 * TaskPower 生命周期级统一存储。
 *
 * Task 定义与工作状态共享 `tasks/<task_id>/task.toml`，每次执行的产物放在同级
 * `runs` 时间戳目录里。所有读写都通过 City 提供的 PowerStorage 文件端口完成，
 * 因此本地与内存 Storage 保持同一语义。
 */

import path from "node:path";
import type { PowerStorage } from "@downcity/city/power";
import type { ShipTaskDefinitionV1 } from "@/task/types/Task.js";
import type {
  TaskDefinitionIssue,
  TaskListItem,
  TaskStoreInspection,
} from "@/task/types/TaskPowerTypes.js";
import { buildTaskToml, parseTaskDefinition } from "./Model.js";
import {
  deriveTaskIdFromTitle,
  isValidTaskId,
  getTaskDir,
  getTaskPath,
  getTaskRootDir,
  getTaskRunDir,
  is_task_run_timestamp,
  normalizeTaskId,
} from "./Paths.js";

/** 列出统一 Store 中全部合法 Task 定义。 */
export async function listTasks(storage: PowerStorage): Promise<TaskListItem[]> {
  const inspection = await inspect_task_definitions(storage);
  if (inspection.issues.length > 0) {
    throw new Error(inspection.issues.map((issue) => issue.error).join("\n"));
  }
  return inspection.tasks;
}

/** 读取 Task 聚合目录下最近一次执行的时间戳目录名。 */
async function read_last_run_at(
  storage: PowerStorage,
  task_dir: string,
): Promise<string | undefined> {
  return await storage.files.read_directory(task_dir)
    .then((children) => children
      .filter((child) => child.is_directory && is_task_run_timestamp(child.name))
      .map((child) => child.name)
      .sort()
      .at(-1))
    .catch(() => undefined);
}

/** 扫描全部 Task 聚合目录，同时保留有效定义和可观察的定义错误。 */
export async function inspect_task_definitions(
  storage: PowerStorage,
): Promise<TaskStoreInspection> {
  const root = require_storage_root(storage);
  const directory_path = getTaskRootDir(root);
  await storage.files.ensure_directory(directory_path);
  const entries = await storage.files.read_directory(directory_path);
  const items: TaskListItem[] = [];
  const issues: TaskDefinitionIssue[] = [];
  for (const entry of entries) {
    const task_id = String(entry.name || "").trim();
    if (!entry.is_directory || !task_id || task_id.startsWith(".") || !isValidTaskId(task_id)) continue;
    const task_file_path = getTaskPath(root, task_id);
    let text = "";
    try {
      text = (await storage.files.read_file(task_file_path)).toString("utf-8");
    } catch (error) {
      issues.push({
        task_id,
        task_path: relative_storage_path(root, task_file_path),
        error: `Task definition cannot be read: ${task_id}: ${to_error_message(error)}`,
      });
      continue;
    }
    const parsed = parseTaskDefinition({
      taskId: task_id,
      text,
      task_file_path,
      data_path: root,
    });
    if (!parsed.ok) {
      issues.push({
        task_id,
        task_path: relative_storage_path(root, task_file_path),
        error: `Task definition is invalid: ${task_id}: ${parsed.error}`,
      });
      continue;
    }

    const last_run_at = await read_last_run_at(storage, getTaskDir(root, task_id));
    items.push({
      ...parsed.task,
      ...(last_run_at ? { last_run_at } : {}),
    });
  }
  return {
    tasks: items.sort((left, right) => left.taskId.localeCompare(right.taskId)),
    issues: issues.sort((left, right) => left.task_id.localeCompare(right.task_id)),
  };
}

/** 根据 City 级唯一 title 解析稳定 task_id。 */
export async function resolveTaskIdByTitle(params: {
  /** TaskPower 生命周期级统一存储。 */
  readonly storage: PowerStorage;
  /** Task 的用户可见标题。 */
  readonly title: string;
}): Promise<string> {
  const title = String(params.title || "").trim();
  if (!title) throw new Error("title is required");
  const tasks = (await inspect_task_definitions(params.storage)).tasks;
  const by_id = tasks.find((item) => item.taskId === title);
  if (by_id) return by_id.taskId;
  const matched = tasks.filter((item) => item.title === title);
  if (matched.length === 1) return matched[0].taskId;
  if (matched.length > 1) throw new Error(`Duplicated task title found: "${title}".`);
  return deriveTaskIdFromTitle(title);
}

/** 读取单个 Task 定义。 */
export async function readTask(params: {
  /** Task 的稳定目录 ID。 */
  readonly taskId: string;
  /** TaskPower 生命周期级统一存储。 */
  readonly storage: PowerStorage;
}): Promise<ShipTaskDefinitionV1> {
  const root = require_storage_root(params.storage);
  const task_id = normalizeTaskId(params.taskId);
  const task_file_path = getTaskPath(root, task_id);
  const text = (await params.storage.files.read_file(task_file_path)).toString("utf-8");
  const parsed = parseTaskDefinition({
    taskId: task_id,
    text,
    task_file_path,
    data_path: root,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.task;
}

/** 删除单个 Task 聚合目录，包括定义与全部运行历史。 */
export async function deleteTask(params: {
  /** Task 的稳定目录 ID。 */
  readonly taskId: string;
  /** TaskPower 生命周期级统一存储。 */
  readonly storage: PowerStorage;
}): Promise<{ taskId: string; taskDirPath: string }> {
  const root = require_storage_root(params.storage);
  const task_id = normalizeTaskId(params.taskId);
  const task_directory = getTaskDir(root, task_id);
  if (!await params.storage.files.path_exists(task_directory)) {
    throw new Error(`Task not found: ${task_id}`);
  }
  await params.storage.files.remove_path(task_directory);
  return {
    taskId: task_id,
    taskDirPath: relative_storage_path(root, task_directory),
  };
}

/** 原子创建或覆盖一个 Task 定义（含工作状态）。 */
export async function writeTask(params: {
  /** Task 的稳定目录 ID。 */
  readonly taskId: string;
  /** 要持久化的完整定义与工作状态。 */
  readonly task: ShipTaskDefinitionV1;
  /** TaskPower 生命周期级统一存储。 */
  readonly storage: PowerStorage;
  /** 是否允许覆盖已经存在的定义。 */
  readonly overwrite?: boolean;
}): Promise<{ taskId: string; taskPath: string }> {
  const root = require_storage_root(params.storage);
  const task_id = normalizeTaskId(params.taskId);
  const task_directory = getTaskDir(root, task_id);
  const task_file_path = getTaskPath(root, task_id);
  await params.storage.files.ensure_directory(task_directory);
  if (await params.storage.files.path_exists(task_file_path) && !params.overwrite) {
    throw new Error(`task.toml already exists: ${relative_storage_path(root, task_file_path)}`);
  }
  await params.storage.files.write_file_atomically(
    task_file_path,
    buildTaskToml({ ...params.task, taskId: task_id, taskPath: relative_storage_path(root, task_file_path) }),
  );
  return {
    taskId: task_id,
    taskPath: relative_storage_path(root, task_file_path),
  };
}

/** 确保 Task run 目录存在并返回稳定绝对/相对路径。 */
export async function ensureRunDir(params: {
  /** Task 的稳定目录 ID。 */
  readonly taskId: string;
  /** 当前 run 使用的 UTC 时间戳目录名。 */
  readonly timestamp: string;
  /** TaskPower 生命周期级统一存储。 */
  readonly storage: PowerStorage;
}): Promise<{ runDir: string; runDirRel: string }> {
  const root = require_storage_root(params.storage);
  const run_directory = getTaskRunDir(root, normalizeTaskId(params.taskId), params.timestamp);
  await params.storage.files.ensure_directory(run_directory);
  return {
    runDir: run_directory,
    runDirRel: relative_storage_path(root, run_directory),
  };
}

/** 校验并返回 PowerStorage 根路径。 */
function require_storage_root(storage: PowerStorage): string {
  const root = String(storage.path || "").trim();
  if (!root) throw new Error("Task storage path is required");
  return root;
}

/** 生成使用正斜杠的 PowerStorage 相对路径。 */
function relative_storage_path(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}

/** 把底层文件错误转换为可观察文本。 */
function to_error_message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
