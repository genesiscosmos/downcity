/**
 * OpenAI-compatible 上游流的安全诊断。
 * 每次打开、每 30 秒有输出时及结束时记录摘要，让平台日志关联请求；不保存原始帧或参数。
 */
import type { ModelStreamEvent, ModelFinishReason } from "@downcity/type";
import type { OpenAIStreamIdentity, OpenAIToolStreamSummary, OpenAIStreamEndReason } from "../../types/OpenAIStreamDiagnostics.js";

/** 统一约束外部请求标识，拒绝正文、URL 查询与超长头部。 */
export function read_stream_request_id(value: string | null): string {
  return value && /^[A-Za-z0-9_.:/-]{1,128}$/.test(value) ? value : `req_${crypto.randomUUID()}`;
}

/** 单一流生命周期拥有统计；结束后停止记录。 */
export class OpenAIStreamDiagnostics {
  private readonly started_at = Date.now();
  private last_report_at = this.started_at;
  private event_count = 0;
  private delta_count = 0;
  private input_bytes = 0;
  private usage_received = false;
  private last_event_type?: ModelStreamEvent["type"];
  private done_at_ms?: number;
  private eof_at_ms?: number;
  private finish_at_ms?: number;
  private finish_reason?: ModelFinishReason;
  private ended = false;
  private readonly encoder = new TextEncoder();
  private readonly tools = new Map<string, OpenAIToolStreamSummary>();

  constructor(private readonly identity: OpenAIStreamIdentity) {
    this.report("opened");
  }

  /** 只累计实际发出的标准事件；工具明细最多保留 16 项，整体计数不截断。 */
  accept(event: ModelStreamEvent): void {
    if (this.ended) return;
    this.event_count += 1;
    this.last_event_type = event.type;
    if (event.type === "model_usage") this.usage_received = true;
    if (event.type === "tool_call_start" && this.tools.size < 16) {
      this.tools.set(event.content_id, { content_id: event.content_id,
        tool_name: /^[A-Za-z0-9_.:-]{1,128}$/.test(event.tool_name) ? event.tool_name : "unknown",
        delta_count: 0, input_bytes: 0 });
    }
    if (event.type === "tool_call_delta") {
      const bytes = this.encoder.encode(event.input_delta).byteLength;
      this.delta_count += 1;
      this.input_bytes += bytes;
      const tool = this.tools.get(event.content_id);
      if (tool) { tool.delta_count += 1; tool.input_bytes += bytes; }
    }
    if (Date.now() - this.last_report_at >= 30_000) this.report("progress");
  }

  /** finish_reason 不结束流，仍等待供应商的尾部 usage 和 DONE。 */
  mark_finish(reason: ModelFinishReason): void {
    this.finish_at_ms ??= Date.now() - this.started_at;
    this.finish_reason = reason;
  }

  /** DONE 和 HTTP EOF 分别记录，避免把两种边界混为一谈。 */
  mark_boundary(boundary: "done" | "eof"): void {
    if (boundary === "done") this.done_at_ms ??= Date.now() - this.started_at;
    else this.eof_at_ms ??= Date.now() - this.started_at;
  }

  /** 结束摘要幂等，不输出异常原文；error_code 必须来自内部稳定分类。 */
  finish(reason: OpenAIStreamEndReason, error_code?: string): void {
    if (this.ended) return;
    this.ended = true;
    this.report(reason, error_code);
  }

  /** 日志失败不影响已确定的模型结果。 */
  private report(phase: string, error_code?: string): void {
    this.last_report_at = Date.now();
    try {
      console.info("model_stream.upstream", {
        ...this.identity, phase, elapsed_ms: this.last_report_at - this.started_at,
        event_count: this.event_count, last_event_type: this.last_event_type, usage_received: this.usage_received,
        tool_delta_count: this.delta_count, tool_input_bytes: this.input_bytes,
        finish_reason: this.finish_reason, finish_at_ms: this.finish_at_ms,
        done_at_ms: this.done_at_ms, eof_at_ms: this.eof_at_ms,
        ...(error_code ? { error_code } : {}), tools: [...this.tools.values()],
      });
    } catch { /* 诊断端不可用不得覆盖真实执行结果。 */ }
  }
}
