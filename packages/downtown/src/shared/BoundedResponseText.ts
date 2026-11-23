/**
 * 不可信 HTTP 错误正文的有限读取。最多保留 16 KiB、最多等待一秒，随后取消剩余流。
 * 只用于本地分类；调用者不得把正文加入异常、日志或模型提示词。
 */
export async function read_bounded_error_text(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Error body read timed out")), 1000); });
  try {
    while (bytes < 16 * 1024) {
      const next = await Promise.race([reader.read(), timeout]);
      if (next.done) break;
      const chunk = next.value.subarray(0, 16 * 1024 - bytes);
      chunks.push(chunk);
      bytes += chunk.byteLength;
    }
  } catch { /* 不可读取或超时的正文仍使用 HTTP 分类。 */ }
  finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(buffer);
}
