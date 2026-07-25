/**
 * 前台 Agent 进程入口。
 *
 * 关键点（中文）：具体依赖装配由 ManagedAgentRuntime 组合根负责，本模块只管理进程信号。
 */

import type { AgentStartOptions } from "@/city/types/AgentStartOptions.js";
import type { DaemonTarget } from "@/city/process/daemon/Types.js";
import { create_managed_agent_runtime } from "@/city/agent/ManagedAgentRuntime.js";

/** 启动前台 Agent，并在收到进程信号时统一停止宿主。 */
export async function runCommand(
  target: DaemonTarget,
  options: AgentStartOptions,
): Promise<void> {
  const managed_agent_runtime = await create_managed_agent_runtime({
    target,
    options,
  });
  const logger = managed_agent_runtime.get_logger();
  let shutting_down = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shutting_down) return;
    shutting_down = true;
    logger.info(`Received ${signal} signal, shutting down...`);
    await managed_agent_runtime.stop();
    logger.info("👋 Downcity city stopped");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  logger.info("=== Downcity Started ===");
}
