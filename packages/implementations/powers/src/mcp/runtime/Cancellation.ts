/** Abortable waits for shared MCP operations; cancelling a waiter never leaves an abort listener behind. */
export async function wait_for_mcp<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await pending;
  signal.throwIfAborted();
  return await new Promise<T>((resolve, reject) => {
    const on_abort = () => { cleanup(); reject(new Error("MCP operation cancelled or timed out")); };
    const cleanup = () => signal.removeEventListener("abort", on_abort);
    signal.addEventListener("abort", on_abort, { once: true });
    pending.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}
