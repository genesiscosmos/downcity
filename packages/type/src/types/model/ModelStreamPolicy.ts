/**
 * 模型执行期限协议。
 * 所有入口使用同一组连接、有效首输出、有效进展空闲和单次总执行期限。
 * 首输出与空闲仅累计等待上游的时间；总期限包含消费方背压。
 */
export interface ModelStreamPolicy {
  /** 建立上游响应流的最长等待，默认沿用首输出预算；不是 TCP 建连期限，同时消耗首输出预算。 */
  connect_timeout_ms: number;
  /** 首个有效输出前累计 open/read 等待，默认 120 秒。 */
  first_output_timeout_ms: number;
  /** 有效进展之间累计 read 等待，默认 120 秒；元数据不刷新。 */
  idle_timeout_ms: number;
  /** 单次执行总墙钟期限，默认 900 秒，包含背压。 */
  total_timeout_ms: number;
}

/** 可跨协议传递的超时阶段，恢复预算属于整个 step。 */
export type ModelTimeoutPhase = "connect" | "first_output" | "idle" | "total" | "recovery_budget";

/** 流守护保留原始执行结果的附加字段，不参与结算。 */
export interface ModelStreamResult {
  /** 按需消费的标准模型事件流。 */
  stream: ReadableStream<import("./ModelStreamEvent.js").ModelStreamEvent>;
}

/** 带标准协议错误的执行异常，不包含供应商原始正文。 */
export interface ModelExecutionError extends Error {
  /** 可跨传输边界读取的安全错误分类。 */
  model_error: import("./ModelError.js").ModelError;
  /** 对应 HTTP 状态，供服务端取消和响应边界使用。 */
  statusCode: number;
}
