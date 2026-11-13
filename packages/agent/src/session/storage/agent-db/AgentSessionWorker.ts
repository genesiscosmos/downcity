/**
 * Agent Session SQLite Worker 入口。
 *
 * Writer 按 Agent 稳定路由并缓存最多 8 个连接，60 秒空闲关闭；Reader 每请求只打开
 * 已有只读库，短事务完成后立即关闭。内存库由进程内唯一拥有者执行，不进入文件池。
 * 任意失败只返回固定错误码，数据库正文、凭据与 SQLite 参数不穿过错误消息。
 */
import { parentPort as parent_port } from "node:worker_threads";
import type { AgentSessionWorkerRequest, AgentSessionWorkerResponse } from "@/types/store/AgentSessionWorker.js";
import { AgentSessionDatabase } from "./AgentSessionDatabase.js";
import { execute_agent_session_command, is_agent_session_write_command } from "./AgentSessionCommands.js";
import { agent_session_failure } from "./AgentSessionErrors.js";

const owners = new Map<string, AgentSessionDatabase>();
const last_used = new Map<string, number>();
const idle_ms = 60_000;

/** 关闭闲置文件连接，不改变任何 Session 或业务状态。 */
function close_idle(): void {
  const now = performance.now();
  for (const [agent_id, used_at] of last_used) {
    if (now - used_at < idle_ms) continue;
    owners.get(agent_id)?.close(); owners.delete(agent_id); last_used.delete(agent_id);
  }
}

const idle_timer = setInterval(close_idle, idle_ms);
idle_timer.unref();

/** Writer 的连接数有硬上限，超限淘汰本线程当前空闲的最老连接。 */
function writer_owner(request: AgentSessionWorkerRequest): AgentSessionDatabase {
  const existing = owners.get(request.database_path);
  if (existing && existing.options.agent_id !== request.agent_id) throw new Error("session_storage_identity_conflict");
  if (existing) {
    last_used.set(request.database_path, performance.now());
    return existing;
  }
  if (owners.size >= 8) {
    const oldest = [...last_used].sort((left, right) => left[1] - right[1])[0][0];
    owners.get(oldest)!.close(); owners.delete(oldest); last_used.delete(oldest);
  }
  const owner = new AgentSessionDatabase({ agent_id: request.agent_id, database_path: request.database_path, allow_create: request.allow_create });
  owners.set(request.database_path, owner); last_used.set(request.database_path, performance.now());
  return owner;
}

parent_port?.on("message", (request: AgentSessionWorkerRequest) => {
  const response: AgentSessionWorkerResponse = { request_id: request.request_id };
  let reader: AgentSessionDatabase | undefined;
  try {
    if (request.release_owner) {
      const existing = owners.get(request.database_path);
      if (existing?.options.agent_id !== request.agent_id && existing) throw new Error("session_storage_identity_conflict");
      existing?.close(); owners.delete(request.database_path); last_used.delete(request.database_path);
      response.result = "null";
      parent_port?.postMessage(response);
      return;
    }
    if (request.database_path === ":memory:") throw new Error("session_storage_memory_reader_requires_owner");
    if (request.readonly && (request.allow_create || is_agent_session_write_command(request.operation))) throw new Error("session_storage_readonly");
    const owner = request.readonly
      ? (reader = new AgentSessionDatabase({ agent_id: request.agent_id, database_path: request.database_path, readonly: true }))
      : writer_owner(request);
    response.result = JSON.stringify(execute_agent_session_command(owner, request.operation));
  } catch (error) {
    const failure = agent_session_failure(error);
    response.error_code = failure.code;
    response.sqlite_code = failure.sqlite_code;
  }
  finally { reader?.close(); }
  parent_port?.postMessage(response);
});

parent_port?.on("close", () => {
  clearInterval(idle_timer);
  for (const owner of owners.values()) owner.close();
  owners.clear(); last_used.clear();
});
