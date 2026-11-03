/**
 * Federation HTTP 执行边界：请求 ID、有界正文、可取消执行和响应流生命周期。
 *
 * 在 middleware 前读取一次有界正文；拒绝请求不进入业务。响应不被整体缓冲，
 * 客户端断开和期限会取消下游信号。取消不承诺撤销已提交的 SQL 或外部副作用。
 */
import { httpError } from "../../utils/helpers.js";
import { build_error_response, log_http_failure } from "./error-response.js";
import { read_bounded_request } from "./bounded-body.js";
import { request_http_limits, type ResolvedFederationHttpPolicy } from "./http-policy.js";

/** HTTP 执行器接受准备好的请求和统一关联 ID，业务层不得另生成一套 ID。 */
export type FederationHttpDispatch = (request: Request, request_id: string) => Promise<Response>;

/** 将取消变为可 race 的拒绝，清理由调用者负责移除事件监听。 */
function abort_promise(signal: AbortSignal): {
  /** 信号触发时拒绝的 Promise。 */
  promise: Promise<never>;
  /** 移除 Promise 注册的事件监听。 */
  dispose: () => void;
} {
  let on_abort: () => void;
  const promise = new Promise<never>((_resolve, reject) => {
    on_abort = () => reject(signal.reason);
    if (signal.aborted) on_abort();
    else signal.addEventListener("abort", on_abort, { once: true });
  });
  // 正文读取阶段尚未进入 race，也要避免提前取消产生未处理 rejection。
  promise.catch(() => {});
  return { promise, dispose: () => signal.removeEventListener("abort", on_abort!) };
}

/** Node 测试或嵌入式调用不因未消费响应的期限阻止退出；Worker 数字计时器保持原样。 */
function unref_timer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { /** Node 计时器可选解引用。 */ unref(): void }).unref();
  }
}

/** 执行一次前台 HTTP 请求，队列任务不经过此期限或继承其取消。 */
export async function execute_federation_http(request: Request, policy: ResolvedFederationHttpPolicy,
  dispatch: FederationHttpDispatch): Promise<Response> {
  const request_id = `req_${crypto.randomUUID()}`;
  const controller = new AbortController();
  const cancel_client = () => controller.abort(httpError(499, "REQUEST_CANCELLED: Client request cancelled"));
  if (request.signal.aborted) cancel_client();
  else request.signal.addEventListener("abort", cancel_client, { once: true });
  const interrupted = abort_promise(controller.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (timer) clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel_client);
    interrupted.dispose();
  };
  const abort_timeout = () => controller.abort(httpError(504, "REQUEST_TIMEOUT: Request execution timed out"));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const limits = request_http_limits(new URL(request.url).pathname, policy);
    const prepared = await read_bounded_request(request, limits, controller.signal);
    if (controller.signal.aborted) throw controller.signal.reason;
    const execution_start = Date.now();
    timer = setTimeout(abort_timeout, limits.execution_timeout_ms);
    unref_timer(timer);
    const execution = Promise.resolve().then(() => dispatch(prepared, request_id));
    // 超时已经返回时，迟到响应仍需取消，否则可能保留上游连接或无界流。
    execution.then((response) => {
      if (controller.signal.aborted) void response.body?.cancel(controller.signal.reason).catch(() => {});
    }, () => {});
    const response = await Promise.race([execution, interrupted.promise]);
    if (controller.signal.aborted) throw controller.signal.reason;
    if (response.headers.get("content-type")?.toLowerCase().split(";")[0]?.trim() === "text/event-stream") {
      clearTimeout(timer);
      timer = setTimeout(abort_timeout, Math.max(1, policy.stream_lifetime_ms - (Date.now() - execution_start)));
      unref_timer(timer);
    }
    // Workers 的 websocket upgrade 不可用标准 Response 构造器重新包装。
    if (response.status === 101) { dispose(); return response; }
    const headers = new Headers(response.headers);
    headers.set("x-request-id", request_id);
    if (!response.body) {
      dispose();
      return new Response(null, { status: response.status, statusText: response.statusText, headers });
    }
    reader = response.body.getReader();
    const body_reader = reader;
    let ended = false;
    let stream_controller: ReadableStreamDefaultController<Uint8Array>;
    const cancel_reader = (reason: unknown) => {
      try { void body_reader.cancel(reason).catch(() => {}); }
      catch { /* 宿主取消失败不覆盖原始超时或客户端取消。 */ }
      finally { try { body_reader.releaseLock(); } catch { /* 终止时不让 reader 清理覆盖原始原因。 */ } }
    };
    const fail_stream = () => {
      if (ended) return;
      ended = true;
      cancel_reader(controller.signal.reason);
      stream_controller.error(controller.signal.reason);
      if ((controller.signal.reason as { statusCode?: number })?.statusCode === 504) log_http_failure(request_id, 504, "REQUEST_TIMEOUT");
      controller.signal.removeEventListener("abort", fail_stream);
      dispose();
    };
    const body = new ReadableStream<Uint8Array>({
      start(output) {
        stream_controller = output;
        controller.signal.addEventListener("abort", fail_stream, { once: true });
        if (controller.signal.aborted) fail_stream();
      },
      async pull(output) {
        try {
          const item = await body_reader.read();
          if (ended) return;
          if (item.done) {
            ended = true;
            controller.signal.removeEventListener("abort", fail_stream);
            dispose(); body_reader.releaseLock(); output.close();
          } else output.enqueue(item.value);
        } catch (error) {
          if (ended) return;
          ended = true;
          controller.signal.removeEventListener("abort", fail_stream);
          cancel_reader(error);
          if (!controller.signal.aborted) controller.abort(error);
          dispose(); output.error(error);
        }
      },
      cancel(reason) {
        if (ended) return;
        ended = true;
        controller.signal.removeEventListener("abort", fail_stream);
        cancel_reader(reason);
        if (!controller.signal.aborted) cancel_client();
        dispose();
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    if (reader) void reader.cancel(error).catch(() => {});
    const response = build_error_response(controller.signal.aborted ? controller.signal.reason : error, request_id);
    if (!controller.signal.aborted) controller.abort(error);
    dispose();
    return response;
  }
}
