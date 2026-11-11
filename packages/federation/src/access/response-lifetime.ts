/**
 * 前台响应流生命周期。保持背压，不缓存完整正文；取消或释放时终止 reader，
 * 并在正常结束、失败、消费方取消三条路径中统一清理监听和请求跟踪。
 */
export function track_response(response: Response, signal: AbortSignal, finish: () => void): Response {
  if (!response.body || response.status === 101) { finish(); return response; }
  const reader = response.body.getReader();
  let ended = false;
  let output_controller: ReadableStreamDefaultController<Uint8Array>;
  const cleanup = () => { signal.removeEventListener("abort", abort); finish(); };
  const abort = () => {
    if (ended) return;
    ended = true;
    void reader.cancel(signal.reason).catch(() => {}).finally(() => reader.releaseLock());
    output_controller.error(signal.reason);
    cleanup();
  };
  const body = new ReadableStream<Uint8Array>({
    start(output) {
      output_controller = output;
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(output) {
      try {
        const item = await reader.read();
        if (ended) return;
        if (item.done) { ended = true; cleanup(); reader.releaseLock(); output.close(); }
        else output.enqueue(item.value);
      } catch (error) {
        if (ended) return;
        ended = true; cleanup(); reader.releaseLock(); output.error(error);
      }
    },
    async cancel(reason) {
      if (ended) return;
      ended = true;
      try { await reader.cancel(reason); } finally { reader.releaseLock(); cleanup(); }
    },
  }, { highWaterMark: 0 });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
