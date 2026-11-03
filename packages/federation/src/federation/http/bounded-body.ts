/**
 * Federation HTTP 正文的有界读取。
 *
 * 在解析或验签前按原始字节限制正文，使用读取总期限及调用方的取消信号
 * 中断挂起的 read。成功后只合并一次正文，不使用 clone/tee 或文本转换。
 * 所有失败路径均尝试取消正文，但不等待底层可能永不结束的 cancel。
 */

import { httpError } from "../../utils/helpers.js";

/** 由服务端 HTTP policy 提供的正文读取额度。 */
export interface bounded_body_options {
  /**
   * 允许读取的原始正文最大字节数，须为非负安全整数。
   * Content-Length 仅用于提前拒绝；每个 Uint8Array chunk 仍按实际字节累计。
   * 等于额度的正文可以通过，超过额度时抛出 413 BODY_TOO_LARGE。
   */
  max_body_bytes: number;
  /**
   * 从本次调用开始计算的正文读取总时限，单位毫秒，须为非负有限数。
   * 收到 chunk 不会重置期限；到期后抛出 408 REQUEST_BODY_TIMEOUT。
   * 无正文的请求直接返回，不建立读取计时器。
   */
  body_timeout_ms: number;
}

/**
 * 收集一次有界正文，并返回携带指定取消信号、原始字节及校正长度的 Request。
 *
 * 调用方负责校验 policy 参数，并将客户端断开或执行超时的 HTTP 错误作为
 * signal.reason 传入；本函数保留该原因的对象身份，不将其转换为读取错误。
 * 非法长度、不支持的编码及读取失败分别使用 400、415 和 400 稳定错误码。
 * 返回正文保留所有原始字节；移除传输分块头，并用实际长度替换声明长度。
 */
export async function read_bounded_request(
  request: Request,
  options: bounded_body_options,
  signal: AbortSignal,
): Promise<Request> {
  const deadline = performance.now() + options.body_timeout_ms;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timeout_timer: ReturnType<typeof setTimeout> | undefined;
  let reject_pending_read: ((reason: unknown) => void) | undefined;
  let interrupted = false;
  let interruption_reason: unknown;

  /** 仅记录第一个中断原因，并使当前挂起的 read race 立即退出。 */
  const interrupt = (reason: unknown): void => {
    if (interrupted) return;
    interrupted = true;
    interruption_reason = reason;
    reject_pending_read?.(reason);
  };

  /** 外层负责为客户端取消及执行超时赋予具体 HTTP 状态。 */
  const on_abort = (): void => interrupt(signal.reason);

  /** 同步检查总期限，避免连续立即完成的 read 使计时器得不到运行。 */
  const check_interruption = (): void => {
    if (signal.aborted) on_abort();
    if (!interrupted && performance.now() >= deadline) {
      interrupt(httpError(408, "REQUEST_BODY_TIMEOUT: Request body read deadline exceeded"));
    }
    if (interrupted) throw interruption_reason;
  };

  try {
    signal.throwIfAborted();
    const content_length = request.headers.get("content-length");
    if (content_length !== null) {
      if (!/^[0-9]+$/u.test(content_length)) {
        throw httpError(400, "INVALID_CONTENT_LENGTH: Content-Length must be a non-negative integer");
      }
      // BigInt 使任意合法十进制长度都能准确判断超限，不受浮点精度影响。
      if (BigInt(content_length) > BigInt(options.max_body_bytes)) {
        throw httpError(413, "BODY_TOO_LARGE: Request body exceeds the byte limit");
      }
    }
    const content_encoding = request.headers.get("content-encoding");
    if (content_encoding !== null && content_encoding.trim().toLowerCase() !== "identity") {
      throw httpError(415, "UNSUPPORTED_CONTENT_ENCODING: Only identity encoding is supported");
    }
    if (request.body === null) return new Request(request, { signal });

    signal.addEventListener("abort", on_abort, { once: true });
    timeout_timer = setTimeout(() => {
      interrupt(httpError(408, "REQUEST_BODY_TIMEOUT: Request body read deadline exceeded"));
    }, options.body_timeout_ms);
    check_interruption();
    try {
      reader = request.body.getReader();
    } catch {
      throw httpError(400, "INVALID_BODY: Unable to acquire request body reader");
    }

    const chunks: Uint8Array[] = [];
    let total_bytes = 0;
    while (true) {
      check_interruption();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        // 每个 read 使用独立的中断 Promise，不在长寿命 Promise 上累积 race 回调。
        const pending_interruption = new Promise<never>((_resolve, reject) => {
          reject_pending_read = reject;
        });
        chunk = await Promise.race([reader.read(), pending_interruption]);
      } catch {
        check_interruption();
        throw httpError(400, "INVALID_BODY: Unable to read request body");
      } finally {
        reject_pending_read = undefined;
      }
      check_interruption();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        throw httpError(400, "INVALID_BODY: Request body chunks must be Uint8Array");
      }
      if (chunk.value.byteLength > options.max_body_bytes - total_bytes) {
        throw httpError(413, "BODY_TOO_LARGE: Request body exceeds the byte limit");
      }
      total_bytes += chunk.value.byteLength;
      // 空块不占额度，也不应让 chunk 引用列表无限增长。
      if (chunk.value.byteLength > 0) chunks.push(chunk.value);
    }

    const body_bytes = new Uint8Array(total_bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body_bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    check_interruption();
    const headers = new Headers(request.headers);
    headers.delete("transfer-encoding");
    headers.set("content-length", String(total_bytes));
    // 显式覆盖 body 后，即使原 Request 已 disturbed，Node 也允许保留其余属性。
    return new Request(request, { body: body_bytes, headers, signal });
  } catch (error) {
    // cancel 可同步抛错、异步拒绝或永不结束；这些情况均不能遮蔽原始错误。
    try {
      const cancellation = reader ? reader.cancel(error) : request.body?.cancel(error);
      void cancellation?.catch(() => {});
    } catch {
      // 已锁定或宿主取消失败时，仍向外传递本次读取的原始错误。
    }
    throw error;
  } finally {
    if (timeout_timer !== undefined) clearTimeout(timeout_timer);
    signal.removeEventListener("abort", on_abort);
    reader?.releaseLock();
  }
}
