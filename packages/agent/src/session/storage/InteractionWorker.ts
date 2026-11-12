/**
 * 文件交互查询线程入口：逐库调用严格只读 Reader，不初始化 Session 或 schema。
 * 批次内任一库失败即丢弃整批结果；宿主负责整次扫描的世代和最终发布。
 * Worker 不持有扫描状态，取消后无控制消息、结果缓存或待清理事实。
 */
import { parentPort } from "node:worker_threads";
import type { SessionInteractionRequest, SessionInteractionResponse } from "../../types/store/SessionInteractionQuery.js";
import { read_file_pending_interactions } from "./SessionInteractionReader.js";

if (!parentPort) throw new Error("InteractionWorker requires a Worker message port");
parentPort.on("message", (request: SessionInteractionRequest) => {
  let response: SessionInteractionResponse;
  try {
    if (request.candidates.length > 32 || Buffer.byteLength(JSON.stringify(request.candidates), "utf8") > 256 * 1024) {
      throw new Error("session_interaction_candidate_too_large: Batch exceeds 32 candidates or 256 KiB");
    }
    const items = request.candidates.flatMap((candidate) => read_file_pending_interactions(
      candidate.database_path, request.agent_id, candidate.session_id, candidate.category,
    ));
    response = { request_id: request.request_id, items };
  } catch (error) {
    response = { request_id: request.request_id, error: error instanceof Error ? error.message : String(error) };
  }
  parentPort!.postMessage(response);
});
