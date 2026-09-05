/**
 * TaskPlugin 生命周期级统一存储。
 *
 * Task 定义和运行记录共享 `tasks/<task_id>/` 聚合目录。所有读写都通过 City
 * 提供的 PluginStorage 文件端口完成，因此本地与内存 Storage 保持同一语义。
 */

import path from "node:path";
import type { PluginStorage } from "@downcity/city/plugin";
import type {
  ShipTaskDefinitionV1,
  ShipTaskFrontmatterV1,
} from "@/task/types/Task.js";
import type { TaskListItem } from "@/task/types/TaskPluginTypes.js";
import { parseTaskMarkdown, buildTaskMarkdown } from "./Model.js";
import {
  deriveTaskIdFromTitle,
  isValidTaskId,
  getTaskDir,
  getTaskMdPath,
  getTaskRootDir,
  getTaskRunDir,
  is_task_run_timestamp,
  normalizeTaskId,
} from "./Paths.js";

/** 列出统一 Store 中全部合法 Task 定义。 */
export async function listTasks(storage: PluginStorage): Promise<TaskListItem[]> {
  const root = require_storage_root(storage);
  const directory_path = getTaskRootDir(root);
  await storage.files.ensure_directory(directory_path);
  const entries = await storage.files.read_directory(directory_path).catch(() => []);
  const items: TaskListItem[] = [];
  for (const entry of entries) {
    const task_id = String(entry.name || "").trim();
    if (!entry.is_directory || !task_id || task_id.startsWith(".") || !isValidTaskId(task_id)) continue;
    const task_md_path = getTaskMdPath(root, task_id);
    const markdown = await storage.files.read_file(task_md_path)
      .then((value) => value.toString("utf-8"))
      .catch(() => "");
    if (!markdown) continue;
    const parsed = parseTaskMarkdown({
      taskId: task_id,
      markdown,
      taskMdPath: task_md_path,
      data_path: root,
    });
    if (!parsed.ok) continue;

    const task_directory = getTaskDir(root, task_id);
    const last_run_timestamp = await storage.files.read_directory(task_directory)
      .then((children) => children
        .filter((child) => child.is_directory && is_task_run_timestamp(child.name))
        .map((child) => child.name)
        .sort()
        .at(-1))
      .catch(() => undefined);
    items.push({
      taskId: task_id,
      title: parsed.task.frontmatter.title,
      description: parsed.task.frontmatter.description,
      ...(parsed.task.body ? { body: parsed.task.body } : {}),
      when: parsed.task.frontmatter.when,
      status: parsed.task.frontmatter.status,
      agent_id: parsed.task.frontmatter.agent_id,
      workspace_id: parsed.task.frontmatter.workspace_id,
      ...(parsed.task.frontmatter.delivery_session
        ? { delivery_session: parsed.task.frontmatter.delivery_session }
        : {}),
      kind: parsed.task.frontmatter.kind || "agent",
      ...(parsed.task.frontmatter.kind === "agent"
        ? { review: Boolean(parsed.task.frontmatter.review) }
        : {}),
      taskMdPath: parsed.task.taskMdPath,
      ...(last_run_timestamp ? { lastRunTimestamp: last_run_timestamp } : {}),
    });
  }
  return items.sort((left, right) => left.taskId.localeCompare(right.taskId));
}

/** 根据 City 级唯一 title 解析稳定 task_id。 */
export async function resolveTaskIdByTitle(params: {
  /** TaskPlugin 生命周期级统一存储。 */
  readonly storage: PluginStorage;
  /** Task 的用户可见唯一标题。 */
  readonly title: string;
}): Promise<string> {
  const title = String(params.title || "").trim();
  if (!title) throw new Error("title is required");
  const matched = (await listTasks(params.storage)).filter((item) => item.title === title);
  if (matched.length === 1) return matched[0].taskId;
  if (matched.length > 1) throw new Error(`Duplicated task title found: "${title}".`);
  return deriveTaskIdFromTitle(title);
}

/** 读取单个 Task 定义。 */
export async function readTask(params: {
  /** Task 的稳定目录 ID。 */
  readonly taskId: string;
  /** TaskPlugin 生命周期级统一存储。 */
  readonly storage: PluginStorage;
}): Promise<ShipTaskDefinitionV1> {
  const root = require_storage_root(params.storage);
  const task_id = normalizeTaskId(params.taskId);
  const task_md_path = getTaskMdPath(root, task_id);
  const markdown = (await params.storage.files.read_file(task_md_path)).toString("utf-8");
  const parsed = parseTaskMarkdown({
    taskId: task_id,
    markdown,
    taskMdPath: task_md_path,
    data_path: root,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.task;
}

/** 删除单个 Task 聚合目录，包括定义与全部运行历史。 */
export async function deleteTask(params: {
  /** Task 的稳定目录 ID。 */
  readonly taskId: string;
  /** TaskPlugin 生命周期级统一存储。 */
  readonly storage: PluginStorage;
}): Promise<{ taskId: string; taskDirPath: string }> {
  const root = require_storage_root(params.storage);
  const task_id = normalizeTaskId(params.taskId);
  const task_md_path = getTaskMdPath(root, task_id);
  if (!await params.storage.files.path_exists(task_md_path)) {
    throw new Error(`Task not found: ${task_id}`);
  }
  const task_directory = getTaskDir(root, task_id);
  await params.storage.files.remove_path(task_directory);
  return {
    taskId: task_id,
    taskDirPath: relative_storage_path(root, task_directory),
  };
}

/** 原子创建或覆盖一个 Task 定义。 */
export async function writeTask(params: {
  /** Task 的稳定目录 ID。 */
  readonly taskId: string;
  /** 要持久化的完整 Task 元数据。 */
  readonly frontmatter: ShipTaskFrontmatterV1;
  /** 要持久化的完整 Task 正文。 */
  readonly body: string;
  /** TaskPlugin 生命周期级统一存储。 */
  readonly storage: PluginStorage;
  /** 是否允许覆盖已经存在的定义。 */
  readonly overwrite?: boolean;
}): Promise<{ taskId: string; taskMdPath: string }> {
  const root = require_storage_root(params.storage);
  const task_id = normalizeTaskId(params.taskId);
  const task_directory = getTaskDir(root, task_id);
  const task_md_path = getTaskMdPath(root, task_id);
  await params.storage.files.ensure_directory(task_directory);
  if (await params.storage.files.path_exists(task_md_path) && !params.overwrite) {
    throw new Error(`task.md already exists: ${relative_storage_path(root, task_md_path)}`);
  }
  await params.storage.files.write_file_atomically(
    task_md_path,
    buildTaskMarkdown({ frontmatter: params.frontmatter, body: params.body }),
  );
  return {
    taskId: task_id,
    taskMdPath: relative_storage_path(root, task_md_path),
  };
}

/** 确保 Task run 目录存在并返回稳定绝对/相对路径。 */
export async function ensureRunDir(params: {
  /** Task 的稳定目录 ID。 */
  readonly taskId: string;
  /** 当前 run 使用的 UTC 时间戳目录名。 */
  readonly timestamp: string;
  /** TaskPlugin 生命周期级统一存储。 */
  readonly storage: PluginStorage;
}): Promise<{ runDir: string; runDirRel: string }> {
  const root = require_storage_root(params.storage);
  const run_directory = getTaskRunDir(root, normalizeTaskId(params.taskId), params.timestamp);
  await params.storage.files.ensure_directory(run_directory);
  return {
    runDir: run_directory,
    runDirRel: relative_storage_path(root, run_directory),
  };
}

/** 校验并返回 PluginStorage 根路径。 */
function require_storage_root(storage: PluginStorage): string {
  const root = String(storage.path || "").trim();
  if (!root) throw new Error("Task storage path is required");
  return root;
}

/** 生成使用正斜杠的 PluginStorage 相对路径。 */
function relative_storage_path(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/");
}
