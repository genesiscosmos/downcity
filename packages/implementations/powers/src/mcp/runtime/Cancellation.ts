/** Abortable waits for shared MCP operations; cancelling a waiter never leaves an abort listener behind. */
import { mcp_abort_error } from "./McpOperationError.js";

export async function wait_for_mcp<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await pending;
  if (signal.aborted) {
    void pending.catch(() => undefined);
    throw mcp_abort_error(signal);
  }
  return await new Promise<T>((resolve, reject) => {
    const on_abort = () => { cleanup(); reject(mcp_abort_error(signal)); };
    const cleanup = () => signal.removeEventListener("abort", on_abort);
    signal.addEventListener("abort", on_abort, { once: true });
    pending.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}
