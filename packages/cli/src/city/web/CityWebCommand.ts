/** `city web` 命令生命周期。 */

import { open_system_browser } from "@/shared/SystemBrowser.js";
import { start_city_web_server } from "@/city/web/CityWebServer.js";
import type { CityWebOptions } from "@/city/types/CityWeb.js";

/** 启动 City Web 控制面并等待进程退出。 */
export async function run_city_web(options: CityWebOptions): Promise<void> {
  const binding = await start_city_web_server(options);
  console.log(`City Web UI: ${binding.url}`);
  if (options.open && !open_system_browser(binding.url)) {
    console.log("无法自动打开浏览器，请手动访问上面的地址。");
  }
  console.log("按 Ctrl+C 停止本地 Web UI。");
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await binding.close();
}

