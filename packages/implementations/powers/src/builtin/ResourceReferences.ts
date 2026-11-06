/**
 * 本机资源删除的只读 Power 引用查询。复用 Task 定义解析与 Messenger 表协议，
 * 不装配 Power、不注册 scheduler、不创建或迁移文件；仅返回公开引用地址。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { LocalDatabase, PowerRepository } from "@downcity/city/local";
import { parseTaskDefinition } from "../task/runtime/Model.js";
import { getTaskRootDir, getTaskPath } from "../task/runtime/Paths.js";
import { get_messenger_store_path } from "../messenger/storage/MessengerStore.js";
import { read_messenger_accounts_config } from "../messenger/accounts/MessengerAccountConfig.js";

/** 不创建 PowerStorage，读取 Task 执行/交付与 Messenger Account/路由的持久化强引用。 */
export async function read_power_agent_references(root_path: string, agent_id: string, immutable = false): Promise<Record<string, unknown>[]> {
  const references: Record<string, unknown>[] = [];
  const task_storage = path.join(root_path, "powers", "task");
  const tasks = await fs.readdir(getTaskRootDir(task_storage), { withFileTypes: true }).catch((error: unknown) => {
    if (is_missing(error)) return [];
    throw error;
  });
  for (const entry of tasks) {
    if (!entry.isDirectory()) continue;
    const file_path = getTaskPath(task_storage, entry.name);
    const text = await fs.readFile(file_path, "utf8").catch((error: unknown) => { if (is_missing(error)) return null; throw error; });
    if (text === null) continue;
    const parsed = parseTaskDefinition({ taskId: entry.name, text, task_file_path: file_path, data_path: task_storage });
    if (!parsed.ok) throw new Error(`Cannot verify Task references: ${entry.name}`);
    if ([parsed.task.agent_id, parsed.task.source_agent_id, parsed.task.delivery_session?.agent_id].includes(agent_id)) references.push({ kind: "task", task_id: entry.name });
  }
  const accounts = read_messenger_accounts_config(new PowerRepository(root_path).get_config("messenger"));
  for (const account of accounts.accounts) if (account.agent_id === agent_id) references.push({ kind: "messenger_account", account_id: account.account_id });
  const database_path = get_messenger_store_path(path.join(root_path, "powers", "messenger"));
  try { await fs.stat(database_path); }
  catch (error) { if (is_missing(error)) return references; throw error; }
  const database = new LocalDatabase({ filename: database_path, read_only: true, immutable });
  try {
    for (const row of database.prepare("SELECT conversation_id FROM messenger_conversations WHERE agent_id = ?").all(agent_id)) references.push({ kind: "messenger_conversation", conversation_id: row.conversation_id });
    const routes_table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messenger_completion_routes'").get();
    if (routes_table && database.prepare("SELECT 1 FROM messenger_completion_routes WHERE agent_id = ? LIMIT 1").get(agent_id)) references.push({ kind: "messenger_completion_route", agent_id });
  } finally { database.close(); }
  return references;
}

/** 缺失是空集合，权限或内容错误阻止删除预检。 */
function is_missing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
