/**
 * 模型事件流期限：响应流建立、首个有效输出、输出空闲与整体执行期限。
 *
 * 首输出和空闲预算只消耗等待上游 open/read 的时间，消费端背压不消耗该预算。
 * 元数据及空增量不重置预算；总期限始终计时。终态后不等待上游无限 EOF，
 * 不伪造用量、不重试模型，也不主动缓冲事件。
 */
import type { ModelStreamEvent } from "./types/model/ModelStreamEvent.js";
import type { ModelExecutionError, ModelStreamPolicy, ModelStreamResult, ModelTimeoutPhase } from "./types/model/ModelStreamPolicy.js";
import type { ModelError } from "./types/model/ModelError.js";

/** 校验宿主定义的模型期限；具体入口决定配置拥有者，不接受请求正文中的覆盖。 */
export function resolve_model_stream_policy(input: Partial<ModelStreamPolicy> = {}): ModelStreamPolicy {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["connect_timeout_ms", "first_output_timeout_ms", "idle_timeout_ms", "total_timeout_ms"].includes(key))) {
    throw new Error("Invalid model stream policy");
  }
  const policy = { connect_timeout_ms: input.first_output_timeout_ms ?? 120_000,
    first_output_timeout_ms: 120_000, idle_timeout_ms: 120_000, total_timeout_ms: 900_000, ...input };
  for (const [key, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new Error(`Invalid model stream limit: ${key}`);
  }
  return policy;
}

/** 只有实际内容或明确工具调用才表示模型进展，空串、初始化和 usage 均不算。 */
export function is_model_output_event(event: ModelStreamEvent): boolean {
  return ((event.type === "text_delta" || event.type === "reasoning_delta") && event.delta.length > 0)
    || (event.type === "tool_call_delta" && event.input_delta.length > 0)
    || event.type === "tool_call_start" || event.type === "tool_call_finish";
}

/** 守护一次模型 open/read 生命周期；不重试、不执行工具、不结算。 */
export async function guard_model_stream<TResult extends ModelStreamResult>(
  open: (signal: AbortSignal) => Promise<TResult>,
  abort_signal?: AbortSignal,
  policy: ModelStreamPolicy = resolve_model_stream_policy(),
): Promise<TResult> {
  const controller = new AbortController();
  const parent_signals = abort_signal ? [abort_signal] : [];
  let source_reader: ReadableStreamDefaultReader<ModelStreamEvent> | undefined;
  let terminal = false;
  let ended = false;
  let first_output = false;
  let remaining_ms = policy.first_output_timeout_ms;
  const total_deadline = performance.now() + policy.total_timeout_ms;
  let total_timer: ReturnType<typeof setTimeout> | undefined;
  let pending_timer: ReturnType<typeof setTimeout> | undefined;
  let pending_started: number | undefined;
  const cancel_source = (reason: unknown) => {
    if (!source_reader) return;
    try { void source_reader.cancel(reason).catch(() => {}); } catch { /* 不覆盖真实终止原因。 */ }
    try { source_reader.releaseLock(); } catch { /* 待完成 read 会由取消完成，不无限等待。 */ }
  };
  const cancel_parent = () => {
    const parent = parent_signals.find((signal) => signal.aborted);
    if (parent && !controller.signal.aborted && !terminal) controller.abort(parent.reason ?? new DOMException("Request cancelled", "AbortError"));
  };
  const on_abort = () => { cancel_source(controller.signal.reason); dispose(); };
  controller.signal.addEventListener("abort", on_abort);
  for (const signal of parent_signals) signal.addEventListener("abort", cancel_parent, { once: true });
  const dispose = () => {
    if (total_timer !== undefined) clearTimeout(total_timer);
    if (pending_timer !== undefined) clearTimeout(pending_timer);
    controller.signal.removeEventListener("abort", on_abort);
    for (const signal of parent_signals) signal.removeEventListener("abort", cancel_parent);
  };
  const fail = (phase: ModelTimeoutPhase) => {
    if (!ended && !terminal && !controller.signal.aborted) controller.abort(create_model_timeout_error(phase));
  };
  total_timer = setTimeout(() => fail("total"), policy.total_timeout_ms);
  unref_timer(total_timer);
  cancel_parent();

  /** 每次仅为实际等待 upstream 的一段时间注册监听，避免长流累计 Promise 回调。 */
  const wait_pending = async <T>(operation: () => Promise<T>, opening = false): Promise<T> => {
    if (performance.now() >= total_deadline) fail("total");
    controller.signal.throwIfAborted();
    if (remaining_ms <= 0) {
      fail(first_output ? "idle" : "first_output");
      throw controller.signal.reason;
    }
    pending_started = performance.now();
    const connect_limited = opening && policy.connect_timeout_ms < remaining_ms;
    pending_timer = setTimeout(() => fail(connect_limited ? "connect" : first_output ? "idle" : "first_output"),
      connect_limited ? policy.connect_timeout_ms : remaining_ms);
    unref_timer(pending_timer);
    let abort_listener: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      abort_listener = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", abort_listener, { once: true });
    });
    try {
      const result = await Promise.race([Promise.resolve().then(operation), aborted]);
      if (performance.now() >= total_deadline) fail("total");
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      controller.signal.removeEventListener("abort", abort_listener);
      if (pending_timer !== undefined) clearTimeout(pending_timer);
      remaining_ms -= performance.now() - pending_started!;
      pending_timer = undefined;
      pending_started = undefined;
    }
  };

  try {
    const opening = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return open(controller.signal);
    });
    // 不理会取消的 provider 可能迟到返回 stream，仍需释放它，而不是再次处理或结算。
    opening.then((value) => {
      if (controller.signal.aborted && is_stream_result(value)) void value.stream.cancel(controller.signal.reason).catch(() => {});
    }, () => {});
    const result = await wait_pending(() => opening, true);
    if (!is_stream_result(result)) throw new Error("Model did not return an event stream");
    source_reader = result.stream.getReader();
    const body_reader = source_reader;
    const stream = new ReadableStream<ModelStreamEvent>({
      async pull(output) {
        if (ended) return;
        try {
          const item = await wait_pending(() => body_reader.read());
          if (ended) return;
          if (item.done) {
            ended = true;
            dispose();
            body_reader.releaseLock();
            output.close();
            return;
          }
          if (is_model_output_event(item.value)) {
            first_output = true;
            remaining_ms = policy.idle_timeout_ms;
          }
          const is_terminal = item.value.type === "model_finish" || item.value.type === "model_error";
          if (is_terminal) {
            terminal = true;
            ended = true;
            dispose();
          }
          output.enqueue(item.value);
          if (is_terminal) {
            output.close();
            cancel_source("Model terminal event received");
          }
        } catch (error) {
          if (ended) return;
          ended = true;
          cancel_source(error);
          // 上游失败不伪装成调用方取消；取消 reader 足以释放流资源。
          dispose();
          output.error(error);
        }
      },
      cancel(reason) {
        if (ended) return;
        ended = true;
        cancel_source(reason);
        if (!controller.signal.aborted) controller.abort(new DOMException("Model stream cancelled", "AbortError"));
        dispose();
      },
    }, { highWaterMark: 0 });
    return { ...result, stream };
  } catch (error) {
    ended = true;
    cancel_source(error);
    // open 失败没有需要继续取消的流；保留原始错误分类。
    dispose();
    throw error;
  }
}

/** 不执行或读取业务正文，只验证模型输出的流入口。 */
function is_stream_result(value: unknown): value is ModelStreamResult {
  return !!value && typeof value === "object" && "stream" in value
    && !!value.stream && typeof value.stream === "object" && "getReader" in value.stream && typeof value.stream.getReader === "function";
}

/** Worker 的数字 timer 与 Node 的对象 timer 共用，未消费的响应不阻止嵌入式进程退出。 */
function unref_timer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { /** Node timer 取消保持事件循环引用的操作。 */ unref(): void }).unref();
  }
}

/** 超时是服务故障，不冒充用户取消；只有连接和首输出阶段具有暂时性恢复语义。 */
export function create_model_timeout_error(phase: ModelTimeoutPhase): ModelExecutionError {
  const model_error: ModelError = {
    code: "provider_timeout", status_code: 504, timeout_phase: phase,
    retryable: phase === "connect" || phase === "first_output",
    message: phase === "recovery_budget" ? "Model recovery budget exhausted" : "Model provider timed out",
  };
  return Object.assign(new Error(model_error.message), { statusCode: 504, model_error });
}
