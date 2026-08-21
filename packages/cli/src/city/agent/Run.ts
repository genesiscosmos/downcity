/**
 * 前台 CLI City 进程入口。
 *
 * 信号处理只管理 City 宿主。具体 Agent 与 Plugin 资源由 CliCityRuntime 释放。
 */

import type { CityDaemonOptions } from "@/city/process/daemon/Types.js";
import { CliCityRuntime } from "@/city/agent/CliCityRuntime.js";
import { unregister_current_daemon_process } from "@/city/process/daemon/Manager.js";

/** 启动前台 City，并等待进程信号。 */
export async function run_city_foreground(options: CityDaemonOptions): Promise<void> {
  const runtime = await CliCityRuntime.start(options);
  let shutting_down = false;
  const shutdown = async (): Promise<void> => {
    if (shutting_down) return;
    shutting_down = true;
    let exit_code = 0;
    try {
      await runtime.stop();
    } catch (error) {
      exit_code = 1;
      console.error("City shutdown failed", error);
    } finally {
      await unregister_current_daemon_process();
      process.exit(exit_code);
    }
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  console.log([
    `City running with ${runtime.city.agents.list().length} Agent(s)`,
    `HTTP: http://${options.host || "127.0.0.1"}:${runtime.http_port}`,
    `RPC: rpc://127.0.0.1:${runtime.rpc_port}/<agent_id>`,
  ].join("\n"));
}
