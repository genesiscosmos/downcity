/**
 * Session 列表共享 Worker 入口，仅依赖只读元数据 helper、投影与快照。
 * 主线程通过 FileSystem 验证并分批提供路径；每条消息同步完成后确认，形成 FIFO 背压。
 * 不接收执行状态、完整消息、Agent 实例或通用文件系统能力。
 */
import { parentPort } from "node:worker_threads";
import type {
  SessionBrowseClearRequest, SessionBrowseRequest, SessionBrowseResponse,
} from "../../types/store/SessionBrowse.js";
import { read_session_metadata_from_database } from "./Browse.js";
import { SessionBrowseSnapshots } from "./SessionBrowseSnapshots.js";

// 文件快照占 48 MiB；主线程 memory 快照另预留 16 MiB，总估算预算 64 MiB。
const snapshots = new SessionBrowseSnapshots(48 * 1024 * 1024);
const port = parentPort;
if (!port) throw new Error("session_list_worker_failed: Missing Worker parent port");

port.on("message", (request: SessionBrowseRequest | SessionBrowseClearRequest) => {
  const response: SessionBrowseResponse = { request_id: request.request_id };
  if (request.action === "clear") {
    for (const store_id of request.store_ids) snapshots.clear(store_id);
    port.postMessage(response);
    return;
  }
  try {
    switch (request.action) {
      case "begin":
        snapshots.begin(request.query);
        break;
      case "batch":
        if (!request.candidates || request.candidates.length > 32) {
          throw new Error("session_list_worker_failed: Invalid candidate batch");
        }
        for (const candidate of request.candidates) {
          const metadata = read_session_metadata_from_database(candidate.database_path, request.query.category);
          if (!metadata) continue; // 保留损坏或已删除数据库的原有跳过语义。
          snapshots.append({
            project_root: "", agent_id: request.query.agent_id,
            session_id: candidate.session_id, metadata,
          }, request.query);
        }
        break;
      case "finish":
        response.page = snapshots.finish(request.query, request.limit);
        break;
      case "page":
        response.page = snapshots.page(request.query, request.cursor ?? "", request.limit);
        break;
    }
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
    if (request.action !== "page") snapshots.clear(request.query.store_id);
  }
  port.postMessage(response);
});
