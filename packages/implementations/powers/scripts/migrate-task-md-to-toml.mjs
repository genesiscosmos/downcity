/**
 * @file 把旧格式 `tasks/<id>/task.md` 一次性迁移为 `tasks/<id>/task.toml`。
 *
 * 背景（中文）
 * - 任务定义与工作状态现在同存于一个 TOML 文件：正文用多行字面量字符串，
 *   工作进度、周期发生项与收件箱是同文件的表与数组表。
 * - 旧的 Markdown + YAML frontmatter 版本不再被读取，迁移后同目录的
 *   `task.md` 会与 `task.toml` 并存，容易让人误以为改 `task.md` 生效。
 *
 * 与运行时的关系（中文）
 * - 字段映射不在这里重写：写文件直接调用 `bin/task/runtime/Model.js` 的
 *   `buildTaskToml`，工作状态校验调用 `normalize_task_state`，
 *   因此迁移结果与「应用内重新保存一次」完全一致。
 * - 只在目标文件不存在时转换；已有 `task.toml` 的目录整体跳过，可重复执行。
 *
 * 使用方式
 *   node packages/implementations/powers/scripts/migrate-task-md-to-toml.mjs --dry-run
 *   node packages/implementations/powers/scripts/migrate-task-md-to-toml.mjs
 *   node packages/implementations/powers/scripts/migrate-task-md-to-toml.mjs <tasks-root>
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { buildTaskToml } from "../bin/task/runtime/Model.js";
import { normalize_task_state } from "../bin/task/runtime/TaskWorkflowModel.js";

const args = process.argv.slice(2);
const dry_run = args.includes("--dry-run");
const tasks_root = path.resolve(
  args.find((arg) => !arg.startsWith("--")) ||
    path.join(process.env.HOME || "", ".downcity/powers/task/tasks"),
);

/** 拆分 `--- yaml ---` 头部与正文；失败时返回 null。 */
function parse_front_matter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  const meta = yaml.load(match[1]);
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return { meta, body: text.slice(match[0].length).replace(/\n+$/, "") };
}

/** 交付目标：旧记录写 `origin_type`，新类型只认 `category`（chat / work）。 */
function to_delivery_session(value) {
  if (!value) return undefined;
  const category = value.category === "chat" || value.category === "work"
    ? value.category
    : value.origin_type === "work"
      ? "work"
      : "chat";
  return {
    agent_id: String(value.agent_id || ""),
    workspace_id: value.workspace_id ? String(value.workspace_id) : null,
    session_id: String(value.session_id || ""),
    category,
  };
}

/** 旧字段 → 新定义：外壳由 when 派生，intake 拆成 source/submission_id。 */
function to_definition(task_id, meta, body) {
  const workflow_state = meta.workflow_state || {};
  const workflow = normalize_task_state({
    ...(meta.workflow || {}),
    ...(workflow_state.occurrences ? { occurrences: workflow_state.occurrences } : {}),
    ...(workflow_state.inbox ? { inbox: workflow_state.inbox } : {}),
  });
  return {
    taskId: task_id,
    title: String(meta.title || "").trim(),
    when: String(meta.when || "@manual").trim(),
    kind: meta.kind === "user" || meta.kind === "self" ? "user" : meta.kind === "script" ? "script" : "agent",
    agent_id: String(meta.agent_id || "").trim(),
    workspace_id: String(meta.workspace_id || "").trim(),
    ...(to_delivery_session(meta.delivery_session) ? { delivery_session: to_delivery_session(meta.delivery_session) } : {}),
    ...(meta.review === true ? { review: true } : {}),
    ...(meta.intake?.text ? { source: String(meta.intake.text) } : {}),
    ...(meta.intake?.submission_id ? { submission_id: String(meta.intake.submission_id) } : {}),
    ...(meta.intake?.agent_id ? { source_agent_id: String(meta.intake.agent_id) } : {}),
    ...(meta.preparation ? { preparing: meta.preparation } : {}),
    body,
    workflow,
    schedule: meta.status === "paused" || meta.status === "disabled" ? "paused" : "enabled",
    taskPath: "",
  };
}

const summary = { converted: 0, skipped: 0, failed: 0 };

for (const entry of await fsp.readdir(tasks_root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
  const directory = path.join(tasks_root, entry.name);
  const markdown_path = path.join(directory, "task.md");
  const toml_path = path.join(directory, "task.toml");
  if (!fs.existsSync(markdown_path)) continue;
  if (fs.existsSync(toml_path)) {
    summary.skipped += 1;
    continue;
  }
  try {
    const parsed = parse_front_matter(await fsp.readFile(markdown_path, "utf-8"));
    if (!parsed) throw new Error("legacy frontmatter cannot be parsed");
    const text = buildTaskToml(to_definition(entry.name, parsed.meta, parsed.body));
    if (!dry_run) {
      const temporary = `${toml_path}.tmp`;
      await fsp.writeFile(temporary, text, "utf-8");
      await fsp.rename(temporary, toml_path);
      await fsp.rm(markdown_path);
    }
    summary.converted += 1;
    console.log(`${dry_run ? "[dry-run] " : ""}converted ${entry.name}`);
  } catch (error) {
    summary.failed += 1;
    console.error(`failed ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(
  `${dry_run ? "[dry-run] " : ""}converted=${summary.converted} skipped=${summary.skipped} failed=${summary.failed} root=${tasks_root}`,
);
if (summary.failed > 0) process.exitCode = 1;
