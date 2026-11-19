/** 存储 Worker 的安全观测协议；不包含目标路径、SQL、正文或参数。 */
import type { SafeErrorDiagnostic } from "@/types/agent/SafeErrorDiagnostic.js";
import type { AgentSessionReadCommand, AgentSessionWriteCommand } from "./AgentSessionWorker.js";

/** 可持久化的 Worker 生命周期或请求失败诊断。 */
export interface AgentSessionWorkerDiagnostic {
  /** 产生事件的独立读池或写池。 */
  pool: "reader" | "writer";
  /** 进程内路由槽位；配合 worker_id 区分线程代次。 */
  slot: number;
  /** 当前进程内的 Worker 线程编号。 */
  worker_id: number;
  /** 固定生命周期或失败事件名。 */
  event: "attached" | "request_failed" | "terminating" | "terminated" | "termination_failed";
  /** 固定失败或回收原因，不能包含任意异常消息。 */
  reason?: "ipc_timeout" | "post_message_failed" | "invalid_response" | "worker_error" | "unexpected_exit" | "command_failed" | "worker_create_failed" | "message_error" | "idle" | "dispose";
  /** 已派发的固定语义命令，不包含业务参数。 */
  command?: AgentSessionReadCommand["command"] | AgentSessionWriteCommand["command"];
  /** 进程内请求编号，用于关联失败及收尾。 */
  request_id?: number;
  /** 事件产生时尚未响应的请求数。 */
  pending_count: number;
  /** 请求派发至失败或终止开始至完成的单调时钟耗时，单位毫秒。 */
  duration_ms?: number;
  /** 确认退出后记录的线程退出码；不存在时省略。 */
  exit_code?: number;
  /** 白名单异常类型、代码和有界原因树。 */
  exception?: SafeErrorDiagnostic;
}

/** 主线程诊断接收端；不能影响事务或 Worker 生命周期。 */
export type AgentSessionDiagnosticSink = (diagnostic: AgentSessionWorkerDiagnostic) => void;
