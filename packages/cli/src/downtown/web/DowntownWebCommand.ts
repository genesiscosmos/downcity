/**
 * `fed web` 命令生命周期。
 *
 * 该模块负责解析本地 Downtown 配置、启动浏览器并在收到
 * 进程信号时关闭本地 HTTP Server。
 */

import { resolve_downtown_target } from "@/downtown/server/DowntownTarget.js";
import { open_system_browser } from "@/shared/SystemBrowser.js";
import { start_downtown_web_server } from "@/downtown/web/DowntownWebServer.js";
import type { DowntownWebOptions } from "@/downtown/types/DowntownWeb.js";

/** 启动并持续运行 Downtown 本地 Web UI。 */
export async function run_downtown_web(options: DowntownWebOptions): Promise<void> {
  const server = await resolve_downtown_target(options);
  if (!server) return;
  const binding = await start_downtown_web_server({
    downtown_name: server.name,
    downtown_url: server.base_url,
    admin_id: server.admin_id,
  }, options);

  console.log(`Downtown Web UI: ${binding.url}`);
  console.log(`Downtown: ${server.name} (${server.base_url})`);
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
