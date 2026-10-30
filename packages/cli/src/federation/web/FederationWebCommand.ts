/**
 * `fed web` 命令生命周期。
 *
 * 该模块负责解析本地 Federation 配置、启动浏览器并在收到
 * 进程信号时关闭本地 HTTP Server。
 */

import { resolve_federation_target } from "@/federation/server/FederationTarget.js";
import { open_system_browser } from "@/shared/SystemBrowser.js";
import { start_federation_web_server } from "@/federation/web/FederationWebServer.js";
import type { FederationWebOptions } from "@/federation/types/FederationWeb.js";

/** 启动并持续运行 Federation 本地 Web UI。 */
export async function run_federation_web(options: FederationWebOptions): Promise<void> {
  const server = await resolve_federation_target(options);
  if (!server) return;
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
