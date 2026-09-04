/**
 * `fed web` 命令生命周期。
 *
 * 该模块负责解析本地 Federation 配置、启动浏览器并在收到
 * 进程信号时关闭本地 HTTP Server。
 */

import {
  readActiveServer,
  readConfig,
  type ServerProfile,
} from "@/federation/core/session.js";
import { open_system_browser } from "@/shared/SystemBrowser.js";
import { start_federation_web_server } from "@/federation/web/FederationWebServer.js";
import type { FederationWebOptions } from "@/federation/types/FederationWeb.js";

/** 启动并持续运行 Federation 本地 Web UI。 */
export async function run_federation_web(options: FederationWebOptions): Promise<void> {
  const server = resolve_server(options.federation);
  if (!server) {
    throw new Error("未找到 Federation。请先运行 `fed server add`，或使用 --federation 指定。");
  }
  const binding = await start_federation_web_server({
    federation_name: server.name,
    federation_url: server.base_url,
    admin_id: server.admin_id,
  }, options);

  console.log(`Federation Web UI: ${binding.url}`);
  console.log(`Federation: ${server.name} (${server.base_url})`);
  if (options.open && !open_system_browser(binding.url)) {
    console.log("无法自动打开浏览器，请手动访问上面的地址。");
  }
  console.log("按 Ctrl+C 停止本地 Web UI。");

  await wait_for_shutdown();
  await binding.close();
}

function resolve_server(selector: string | undefined): ServerProfile | undefined {
  if (!selector?.trim()) return readActiveServer();
  const normalized = selector.trim();
  return readConfig().servers.find((item) => item.name === normalized || item.base_url === normalized);
}

function wait_for_shutdown(): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
