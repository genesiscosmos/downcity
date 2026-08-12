/**
 * City daemon 子进程参数构造器。
 *
 * HTTP 与 RPC 各自使用一个 City 级固定端口，不再为每个 Agent 动态分配端口。
 */

import type { CityDaemonOptions } from "@/city/process/daemon/Types.js";

/** 把 City 启动选项转换成前台子进程 argv。 */
export function build_city_run_args(options: CityDaemonOptions): string[] {
  const host = String(options.host || "127.0.0.1").trim() || "127.0.0.1";
  const http_port = options.http_port ?? 5314;
  const rpc_port = options.rpc_port ?? 15314;
  validate_port(http_port, "HTTP");
  validate_port(rpc_port, "RPC");
  if (http_port === rpc_port) throw new Error("City HTTP and RPC ports must be different");
  return [
    "on",
    "--foreground",
    "true",
    "--host",
    host,
    "--port",
    String(http_port),
    "--rpc-port",
    String(rpc_port),
  ];
}

/** 校验 TCP 端口。 */
function validate_port(port: number, label: string): void {
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`${label} port must be an integer between 1 and 65535`);
  }
}
