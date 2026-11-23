/**
 * 连接执行租约与结果消费边界。流式结果持有租约直到 EOF、取消或错误，
 * 普通 JSON 在 Promise 完成时释放；单连接身份变更不会影响其他来源。
 */

/** 可识别的 Town 错误，不复制远端错误正文。 */
export class TownError extends Error {
  constructor(readonly code: string) { super(code); this.name = "TownError"; }
}

/** 仅由来源拥有者操作的同步门禁；获取租约与开始变更处于同一 JS 原子区间。 */
export class ExecutionLease {
  private count = 0;
  private changing = false;
  private closed = false;

  /** 请求在实际发送前取得租约；幂等释放。 */
  acquire(): () => void {
    if (this.closed) throw new TownError("town_source_unavailable");
    if (this.changing) throw new TownError("town_connection_changing");
    this.count += 1;
    let released = false;
    return () => { if (!released) { released = true; this.count -= 1; } };
  }

  /** 变更期间封闭入口；忙时立即失败，不偷偷取消已发出的计费请求。 */
  begin_change(): () => void {
    if (this.closed) throw new TownError("town_source_unavailable");
    if (this.changing) throw new TownError("town_connection_changing");
    if (this.count) throw new TownError("town_connection_busy");
    this.changing = true;
    return () => { this.changing = false; };
  }

  /** 只在变更门禁持有期间关闭；旧视图从此拒绝新请求。 */
  close(): void { this.closed = true; }
}

/** 不提前预取流；没有消费者时租约持续存在，防止未完成响应被当作空闲。 */
export function lease_stream<T>(stream: ReadableStream<T>, release: () => void, signal?: AbortSignal): ReadableStream<T> {
  const reader = stream.getReader();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
    release();
  };
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined).finally(finish); };
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  return new ReadableStream<T>({
    async pull(controller) {
      if (finished) { controller.close(); return; }
      try {
        const item = await reader.read();
        if (item.done) { finish(); controller.close(); }
        else controller.enqueue(item.value);
      } catch (error) { finish(); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
  }, { highWaterMark: 0 });
}

/** Request/Response 调用既保留 raw 正文，也阻止 text/json 消费绕开租约。 */
export function lease_response<T extends object>(response: T, release: () => void, signal?: AbortSignal): T {
  const body = (response as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body) { release(); return response; }
  const tracked = lease_stream(body, release, signal);
  const consume = (method: string, args: unknown[]) => {
    const headers = (response as { headers?: Headers }).headers;
    const projected = new Response(tracked, { headers: headers ? new Headers(headers) : undefined });
    return Reflect.apply(Reflect.get(projected, method), projected, args);
  };
  return new Proxy(response, {
    get(target, property) {
      if (property === "body") return tracked;
      if (property === "clone") return () => { throw new TownError("town_response_clone_unsupported"); };
      if (["json", "text", "arrayBuffer", "blob", "formData", "bytes"].includes(String(property))) {
        return (...args: unknown[]) => consume(String(property), args);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** 保护 SDK 用户视图，防止拿到旧 AI/Service/Model 句柄后绕过注册门禁。 */
export function guarded_user<T extends object>(target: T, acquire: () => () => void): T {
  const wrap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(wrap);
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) === Object.prototype) return value;
    return new Proxy(value, {
      get(object, property) {
        if (["set_token", "set_token_resolver", "clear_credentials", "with_city", "login", "login_start", "continue", "exchange", "status", "logout"].includes(String(property))) {
          throw new TownError("town_auth_adapter_required");
        }
        const member = Reflect.get(object, property, object);
        if (typeof member !== "function") return wrap(member);
        return (...args: unknown[]) => {
          const release = acquire();
          try {
            const result: unknown = Reflect.apply(member, object, args);
            if (result instanceof Promise) {
              return result.then((resolved: unknown) => {
                if (resolved instanceof ReadableStream) return lease_stream(resolved, release);
                if (resolved && typeof resolved === "object" && "body" in resolved && "status" in resolved) return lease_response(resolved, release);
                release();
                return wrap(resolved);
              }, (error: unknown) => { release(); throw error; });
            }
            release();
            return wrap(result);
          } catch (error) { release(); throw error; }
        };
      },
      set() { throw new TownError("town_readonly_view"); },
    });
  };
  return wrap(target) as T;
}
