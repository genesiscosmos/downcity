/**
 * Session v13 的业务交付引用迁移；只解释 Task.delivery_session 与 Memory.recipient。
 * Memory Job 来源、证据 category、请求键、订阅身份及不可变待交付正文完整保留。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire as create_require } from "node:module";
import { digest, fail } from "./session-v7-database.mjs";
import { exists, inside, ordinary } from "./session-v8-files.mjs";

const { parse: parse_toml, stringify: stringify_toml } = create_require(new URL("../../packages/city/package.json", import.meta.url))("smol-toml");

/** 只遍历已声明的运行时目录，不跟随链接，不枚举用户工作区。 */
function children(directory) {
  if (!exists(directory)) return [];
  ordinary(directory, true);
  return fs.readdirSync(directory).sort().map(name => {
    const file_path = path.join(directory, name);
    const stat = fs.lstatSync(file_path);
    if (stat.isSymbolicLink()) fail("unsafe_storage_path");
    return { name, file_path, directory: stat.isDirectory() };
  });
}

/** 纳入 Task 当前定义与运行快照、Memory 的交付订阅，其他业务文件不参与改写。 */
export function discover_deliveries(root_path) {
  const records = [];
  const add = (file_path, kind) => {
    ordinary(file_path);
    records.push({ relative_path: path.relative(root_path, file_path), kind });
  };
  for (const task of children(path.join(root_path, "powers/task/tasks"))) {
    if (!task.directory) continue;
    const definition = path.join(task.file_path, "task.toml");
    if (exists(definition)) add(definition, "task-definition");
    for (const run of children(path.join(task.file_path, "runs"))) {
      const snapshot = path.join(run.file_path, "run.json");
      if (run.directory && exists(snapshot)) add(snapshot, "task-run");
    }
  }
  for (const entry of children(path.join(root_path, "powers/memory/delivery/subscriptions"))) {
    if (!entry.directory && entry.name.endsWith(".json")) add(entry.file_path, "memory-delivery");
  }
  for (const record of records) inside(root_path, record.relative_path);
  return records;
}

/** 已有字段冲突或非法类型必须阻断，不能猜测或重新绑定目标身份。 */
function convert_reference(input) {
  if (input === undefined) return false;
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("delivery_session_invalid");
  if (!("category" in input)) {
    if (!["chat", "work"].includes(input.type)) fail("delivery_session_type_invalid");
    return false;
  }
  if ("type" in input || !["chat", "work"].includes(input.category)) fail("delivery_session_type_invalid");
  input.type = input.category;
  delete input.category;
  return true;
}

/** 对业务文档定点转换；重编码后的 TOML 必须与转换对象逐字段等价。 */
export function convert_delivery(source, scope) {
  const document = scope.kind === "task-definition" ? parse_toml(source.toString()) : JSON.parse(source);
  const changed = convert_reference(scope.kind === "memory-delivery" ? document.recipient : document.delivery_session);
  if (!changed) return { content: source, state: "unchanged", stopped: false };
  const text = scope.kind === "task-definition" ? stringify_toml(document) : JSON.stringify(document);
  const decoded = scope.kind === "task-definition" ? parse_toml(text) : JSON.parse(text);
  if (digest(decoded) !== digest(document)) fail("delivery_document_roundtrip_failed");
  return { content: Buffer.from(text), state: "converted", stopped: false };
}
