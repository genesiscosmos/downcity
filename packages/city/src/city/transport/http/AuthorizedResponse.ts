/**
 * 长连接授权租期：定期检查宿主权限，撤销/到期后取消底层请求及响应流。
 * 数据库配置变更可来自其他进程，因此不依赖进程内变更事件。
 */

/** 执行已通过初始授权的请求，并在流结束时释放定时器及监听。 */
export async function authorized_response(
  request: Request,
  authorize: () => Promise<boolean>,
  dispatch: (request: Request) => Promise<Response>,
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason ?? new Error("HTTP request closed"));
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  let checking = false;
  const timer = setInterval(() => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    void authorize().then((allowed) => {
      if (!allowed) controller.abort(new Error("City access revoked or expired"));
    }, () => controller.abort(new Error("City authorization unavailable"))).finally(() => { checking = false; });
  }, 1000);
  timer.unref?.();
  const cleanup = () => { clearInterval(timer); request.signal.removeEventListener("abort", abort); };
  try {
    const response = await dispatch(new Request(request, { signal: controller.signal }));
    if (!response.body) { cleanup(); return response; }
    const reader = response.body.getReader();
    const close = () => { cleanup(); void reader.cancel().catch(() => {}); };
    controller.signal.addEventListener("abort", close, { once: true });
    const release = () => { cleanup(); controller.signal.removeEventListener("abort", close); };
    const stream = new ReadableStream<Uint8Array>({
      async pull(target) {
        try {
          controller.signal.throwIfAborted();
          const chunk = await reader.read();
          controller.signal.throwIfAborted();
          if (chunk.done) { release(); target.close(); }
          else target.enqueue(chunk.value);
        } catch (error) { release(); target.error(error); }
      },
      async cancel() { controller.abort(new Error("HTTP client disconnected")); release(); await reader.cancel().catch(() => {}); },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) { cleanup(); throw error; }
}
