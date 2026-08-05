/**
 * `fed web` 命令生命周期。
 *
 * 该模块负责解析本地 Federation 配置、补齐 Admin Key、启动浏览器并在收到
 * 进程信号时关闭本地 HTTP Server。
 */

import {
  readActiveServer,
  readConfig,
  updateServer,
  type ServerProfile,
} from "@/federation/core/session.js";
import { password } from "@/federation/tui/Prompts.js";
import { open_system_browser } from "@/shared/SystemBrowser.js";
import { start_federation_web_server } from "@/federation/web/FederationWebServer.js";
import type { FederationWebOptions } from "@/federation/types/FederationWeb.js";

/** 启动并持续运行 Federation 本地 Web UI。 */
export async function run_federation_web(options: FederationWebOptions): Promise<void> {
  const server = resolve_server(options.federation);
  if (!server) {
    throw new Error("未找到 Federation。请先运行 `fed server add`，或使用 --federation 指定。");
  }
  const configured_server = await ensure_admin_secret(server);
  const binding = await start_federation_web_server({
    federation_name: configured_server.name,
    federation_url: configured_server.base_url,
    admin_secret_key: configured_server.admin_secret_key!,
  }, options);

  console.log(`Federation Web UI: ${binding.url}`);
  console.log(`Federation: ${configured_server.name} (${configured_server.base_url})`);
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

async function ensure_admin_secret(server: ServerProfile): Promise<ServerProfile> {
  if (server.admin_secret_key?.trim()) return server;
  const admin_secret_key = await password({ message: "admin_secret_key" });
  if (!admin_secret_key || typeof admin_secret_key !== "string" || !admin_secret_key.trim()) {
    throw new Error("启动 fed web 需要 admin_secret_key。");
  }
  return updateServer(server.base_url, {
    ...server,
    admin_secret_key: admin_secret_key.trim(),
  });
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
