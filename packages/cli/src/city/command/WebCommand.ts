/** City Web 命令装配。 */

import { Command } from "commander";
import { run_city_web } from "@/city/web/CityWebCommand.js";
import type { CityWebOptions } from "@/city/types/CityWeb.js";
import { parsePort } from "@/shared/IndexSupport.js";

/** 注册 `city web`。 */
export function register_web_command(program: Command): void {
  program.command("web")
    .description("启动本地 City Web 控制面")
    .option("-h, --host <host>", "监听地址", "127.0.0.1")
    .option("-p, --port <port>", "监听端口", parsePort, 0)
    .option("--open [enabled]", "启动后打开浏览器", true)
    .action(async (options: CityWebOptions) => await run_city_web(options));
}

