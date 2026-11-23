#!/usr/bin/env node
/** launchd/systemd 的专用入口：只执行显式 --config 指定的已安装服务。 */
import { isAbsolute } from "node:path";
import { run_managed_service } from "./ServiceRunnerRuntime.js";

const arguments_list = process.argv.slice(2);
if (arguments_list.length !== 2 || arguments_list[0] !== "--config" || !isAbsolute(arguments_list[1]!)) {
  console.error("ServiceRunner requires --config <absolute-path>");
  process.exitCode = 1;
} else {
  run_managed_service(arguments_list[1]!).then((code) => { process.exitCode = code; }).catch(() => {
    console.error("Unable to load the installed Downtown service configuration; explicit repair is required");
    // 无法读取配置时无法安全更新恢复窗口；以正常退出抑制 launchd 的无限恢复。
    process.exitCode = 0;
  });
}
