/**
 * 模型事件流期限：连接建立、首个有效输出、输出空闲与整体执行期限。
 *
 * 首输出和空闲预算只消耗等待上游 open/read 的时间，消费端背压不消耗该预算。
 * 元数据及空增量不重置预算；总期限始终计时。终态后不等待上游无限 EOF，
 * 不伪造用量、不重试模型，也不主动缓冲事件。
 */
import type { ModelStreamEvent } from "@downcity/type";
import type { AIChannelStreamResult, AIModelStreamPolicy } from "../../types/AI.js";
import type { Context } from "../service.js";
import { httpError } from "../../utils/helpers.js";

/** 校验服务端计时配置，不能由单次客户端请求覆盖。 */
export function resolve_model_stream_policy(input: Partial<AIModelStreamPolicy> = {}): AIModelStreamPolicy {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["first_output_timeout_ms", "idle_timeout_ms", "total_timeout_ms"].includes(key))) {
    throw new Error("Invalid model stream policy");
  }
  const policy = { first_output_timeout_ms: 120_000, idle_timeout_ms: 120_000, total_timeout_ms: 900_000, ...input };
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

/** 在流编码与结算之前守护所有语言模型入口，适用于原生、OpenAI 与 Relay。 */
export async function execute_model_stream(ctx: Context, open: () => Promise<unknown>,
  policy: AIModelStreamPolicy): Promise<AIChannelStreamResult> {
  const controller = new AbortController();
  const parent_signals = [...new Set([ctx.abort_signal, ctx.request?.signal].filter((value): value is AbortSignal => value !== undefined))];
  const timeout = (code: string, message: string) => httpError(504, `${code}: ${message}`);
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
    if (parent && !controller.signal.aborted && !terminal) controller.abort(parent.reason ?? httpError(499, "REQUEST_CANCELLED: Request cancelled"));
  };
  const on_abort = () => { cancel_source(controller.signal.reason); dispose(); };
  controller.signal.addEventListener("abort", on_abort);
  for (const signal of parent_signals) signal.addEventListener("abort", cancel_parent, { once: true });
  ctx.abort_signal = controller.signal;
  const dispose = () => {
    if (total_timer !== undefined) clearTimeout(total_timer);
    if (pending_timer !== undefined) clearTimeout(pending_timer);
    controller.signal.removeEventListener("abort", on_abort);
    for (const signal of parent_signals) signal.removeEventListener("abort", cancel_parent);
  };
  const fail = (code: string, message: string) => {
    if (!ended && !terminal && !controller.signal.aborted) controller.abort(timeout(code, message));
  };
  total_timer = setTimeout(() => fail("MODEL_EXECUTION_TIMEOUT", "Model execution timed out"), policy.total_timeout_ms);
  unref_timer(total_timer);
  cancel_parent();

  /** 每次仅为实际等待 upstream 的一段时间注册监听，避免长流累计 Promise 回调。 */
  const wait_pending = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (performance.now() >= total_deadline) fail("MODEL_EXECUTION_TIMEOUT", "Model execution timed out");
    controller.signal.throwIfAborted();
    if (remaining_ms <= 0) {
      fail(first_output ? "MODEL_IDLE_TIMEOUT" : "MODEL_FIRST_OUTPUT_TIMEOUT", first_output ? "Model output stalled" : "Model first output timed out");
      throw controller.signal.reason;
    }
    pending_started = performance.now();
    pending_timer = setTimeout(() => fail(first_output ? "MODEL_IDLE_TIMEOUT" : "MODEL_FIRST_OUTPUT_TIMEOUT",
      first_output ? "Model output stalled" : "Model first output timed out"), remaining_ms);
    unref_timer(pending_timer);
    let abort_listener: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      abort_listener = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", abort_listener, { once: true });
    });
    try {
      const result = await Promise.race([Promise.resolve().then(operation), aborted]);
      if (performance.now() >= total_deadline) fail("MODEL_EXECUTION_TIMEOUT", "Model execution timed out");
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
      return open();
    });
    // 不理会取消的 provider 可能迟到返回 stream，仍需释放它，而不是再次处理或结算。
    opening.then((value) => {
      if (controller.signal.aborted && is_stream_result(value)) void value.stream.cancel(controller.signal.reason).catch(() => {});
    }, () => {});
    const result = await wait_pending(() => opening);
    if (!is_stream_result(result)) throw httpError(500, "AIChannel did not return a model event stream");
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
          if (!controller.signal.aborted) controller.abort(error);
          dispose();
          output.error(error);
        }
      },
      cancel(reason) {
        if (ended) return;
        ended = true;
        cancel_source(reason);
        if (!controller.signal.aborted) controller.abort(httpError(499, "REQUEST_CANCELLED: Model stream cancelled"));
        dispose();
      },
    }, { highWaterMark: 0 });
    return { ...result, stream };
  } catch (error) {
    ended = true;
    cancel_source(error);
    if (!controller.signal.aborted) controller.abort(error);
    dispose();
    throw error;
  }
}

/** 不执行或读取业务正文，只验证模型输出的流入口。 */
function is_stream_result(value: unknown): value is AIChannelStreamResult {
  return !!value && typeof value === "object" && "stream" in value
    && !!value.stream && typeof value.stream === "object" && "getReader" in value.stream && typeof value.stream.getReader === "function";
}

/** Worker 的数字 timer 与 Node 的对象 timer 共用，未消费的响应不阻止嵌入式进程退出。 */
function unref_timer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { /** Node timer 取消保持事件循环引用的操作。 */ unref(): void }).unref();
  }
}
