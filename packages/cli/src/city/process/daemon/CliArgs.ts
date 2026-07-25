/**
 * 负责把 commander 解析到的 options 转换成子进程 CLI 参数。
 *
 * 关键点
 * - daemon（来自 `agent start` / `agent restart`）会拉起一个前台 `agent start`
 *   进程（显式 `--foreground true`），这里负责拼装其 argv。
 * - City 托管的 HTTP gateway 与 agent 本机 RPC 使用不同端口，避免职责混用。
 */

import type { AgentStartOptions } from "@/city/types/AgentStartOptions.js";
import { allocateAvailablePort } from "@/city/process/daemon/PortAllocator.js";

/**
 * 将 daemon 选项转换为 `agent start` 子进程 argv。
 *
 * 关键点（中文）
 * - daemon 始终启动 `agent start` 前台流程，因此参数统一映射到 `agent start` CLI 形态。
 * - 只透传用户显式传入的字段，避免污染默认值决策。
 */
export const buildRunArgsFromOptions = async (
  project_root: string,
  options: AgentStartOptions,
): Promise<string[]> => {
  // 关键点（中文）：daemon 子进程必须强制前台模式，避免再次进入 startCommand 形成递归拉起。
  const args: string[] = ["agent", "start", project_root, "--foreground", "true"];

  // 关键点（中文）：host 未指定时统一落到 0.0.0.0，保持历史监听行为。
  const host = String(options.host || "0.0.0.0").trim() || "0.0.0.0";

  // 关键点（中文）：外层 HTTP gateway 端口统一由 City 分配。
  const port = await allocateAvailablePort({ host });
  if (!Number.isFinite(port) || Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid allocated port: ${String(port)}`);
  }

  // 关键点（中文）：本机 RPC 端口独立分配到另一段端口区间，避免和 HTTP gateway 冲突。
  const rpc_port =
    typeof options.rpcPort === "number" && Number.isInteger(options.rpcPort)
      ? options.rpcPort
      : await allocateAvailablePort({
          host: "127.0.0.1",
          start: 15314,
          end: 16399,
        });
  if (
    !Number.isFinite(rpc_port) ||
    Number.isNaN(rpc_port) ||
    rpc_port <= 0 ||
    rpc_port > 65535
  ) {
    throw new Error(`Invalid allocated rpc port: ${String(rpc_port)}`);
  }
  if (rpc_port === port) {
    throw new Error(`HTTP port and RPC port must be different: ${port}`);
  }

  args.push("--port", String(port));
  args.push("--rpc-port", String(rpc_port));
  args.push("--host", host);

  return args;
};
