/**
 * Daemon 端口分配器。
 *
 * 关键点（中文）
 * - 当用户未显式传 `--port` 时，为每个 agent 自动挑选可用端口。
 * - 仅负责“本机可监听性”探测，不做跨进程强一致锁；最终仍以 listen 成功为准。
 */

import net from "node:net";

const DEFAULT_PORT_RANGE_START = 5314;
const DEFAULT_PORT_RANGE_END = 6399;
const RESERVED_PORTS = new Set<number>([5315]);

type AllocatePortParams = {
  start?: number;
  end?: number;
  host?: string;
};

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * 探测单个端口是否可监听。
 *
 * 关键点（中文）
 * - 必须按目标 host 探测（默认 0.0.0.0），避免和实际监听地址不一致导致误判。
 */
async function canListenPort(port: number, host: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * 在给定范围内分配一个可用端口。
 */
export async function allocateAvailablePort(
  params: AllocatePortParams = {},
): Promise<number> {
  const start = params.start ?? DEFAULT_PORT_RANGE_START;
  const end = params.end ?? DEFAULT_PORT_RANGE_END;
  const host = String(params.host || "0.0.0.0").trim() || "0.0.0.0";
  if (!isValidPort(start) || !isValidPort(end) || start > end) {
    throw new Error(`Invalid port range: ${start}-${end}`);
  }

  for (let port = start; port <= end; port += 1) {
    if (RESERVED_PORTS.has(port)) continue;
    // 关键点（中文）：逐个探测可用端口，找到即返回，避免强依赖外部状态文件。
    if (await canListenPort(port, host)) return port;
  }

  throw new Error(`No available port in range ${start}-${end} for host ${host}`);
}
