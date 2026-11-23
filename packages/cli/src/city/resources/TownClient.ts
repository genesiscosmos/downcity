/** CLI Town 管理客户端：在线固定 owner；离线取得独占租约后使用临时 Town，不启动 City。 */
import { Town, read_city_host_state } from "@downcity/city";
import { LocalHostClient, ResourceError, RootLease, resolve_resource_root } from "@downcity/city/local";
import { create_cli_local_data } from "../runtime/LocalData.js";
import { CliTownHost } from "../runtime/CliTownHost.js";

/** 单个操作范围内固定 owner 实例；读取响应分块期间不重新发现或隐式重发。 */
export async function with_cli_town<T>(root: string | undefined, operation: (call: TownManagementCall) => Promise<T>): Promise<T> {
  const root_path = resolve_resource_root(root);
  const owner = await LocalHostClient.connect({ root_path });
  if (owner) {
    try { return await operation((method, input = {}, signal) => owner.call(method, input, { timeout_ms: 60_000, abort_signal: signal })); }
    finally { await owner.close(); }
  }
  const lease = RootLease.acquire_write(root_path);
  let data: ReturnType<typeof create_cli_local_data> | undefined;
  let host: CliTownHost | undefined;
  let town: Town | undefined;
  try {
    if (await read_city_host_state(root_path)) throw new ResourceError("host_unreachable", "City became active; retry through its owner", 5);
    data = create_cli_local_data(root_path);
    host = new CliTownHost(data);
    town = new Town("cli_management", host.options);
    host.attach(town);
    const dispatcher = host;
    return await operation(async (method, input = {}, signal) => {
      signal?.throwIfAborted();
      if (!signal) return await dispatcher.dispatch(method, input);
      // 离线与 IPC 一样可取消等待；caller 的 finally 再用原 request_id 取消 owner reader。
      let abort: (() => void) | undefined;
      try {
        return await Promise.race([dispatcher.dispatch(method, input), new Promise<never>((_resolve, reject) => {
          abort = () => reject(signal.reason ?? new Error("Service call cancelled"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        })]);
      } finally { if (abort) signal.removeEventListener("abort", abort); }
    });
  } finally {
    try { await host?.close_responses(); }
    finally { try { await town?.close(); } finally { try { await host?.dispose(); } finally { data?.database.close(); lease.release(); } } }
  }
}

/** 一份已绑定 owner/root 的管理调用函数，signal 只取消客户端等待。 */
export type TownManagementCall = (
  /** 已公开的 Town 管理方法，不接受任意对象路径。 */
  method: string,
  /** 方法的 JSON 输入；调用者不得传凭据绕开 Town 来源。 */
  input?: Record<string, unknown>,
  /** 取消本次等待；实际响应另经 cancel 明确释放。 */
  signal?: AbortSignal,
) => Promise<unknown>;

/** 每次普通请求都先发现 owner；已观察 owner 后失败不回退数据库。 */
export async function call_cli_town(method: string, input: Record<string, unknown> = {}, root?: string): Promise<unknown> {
  return await with_cli_town(root, (call) => call(method, input));
}
