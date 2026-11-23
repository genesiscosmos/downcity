/**
 * 待迁入 city downtown 的 Service 访问命令定义。
 * 当前未注册到公开命令树；保留详情、OpenAPI 和通用 Action 的参数契约供迁移，
 * 接线时必须采用显式 downtown_id 和 Town 宿主调用，不能恢复全局当前登录入口。
 */
import type { Command } from "commander";
import { run_downtown_access } from "../shared/DowntownAccess.js";
import type { DowntownAccessOptions } from "../types/DowntownAccess.js";
import { t } from "@/shared/CliLocale.js";

/** 给命令增加统一目标与输出选项，不改变持久连接。 */
function access_options(command: Command): Command {
  return command
    .option("--url <url>", t({ zh: "临时访问的Downtown地址", en: "temporary Downtown URL" }))
    .option("--json", t({ zh: "输出完整JSON；流按原始内容转发", en: "complete JSON output; streams remain raw" }));
}

/** 注册四个服务访问命令。 */
export function register_downtown_access_commands(downtown: Command): void {
  access_options(downtown.command("services").description(t({ zh: "查看服务目录、Action摘要与本地可用状态", en: "show service catalog, actions and local readiness" })))
    .action((options: DowntownAccessOptions) => run_downtown_access("services", options));
  access_options(downtown.command("service <service_id>").description(t({ zh: "读取服务完整说明与API文档", en: "read full service instructions and API documentation" })))
    .action((service_id: string, options: DowntownAccessOptions) => run_downtown_access("service", options, service_id));
  access_options(downtown.command("openapi").description(t({ zh: "读取或导出OpenAPI文档", en: "read or export OpenAPI" })))
    .option("--output <file>", t({ zh: "写入指定文件", en: "write to a file" }))
    .action((options: DowntownAccessOptions) => run_downtown_access("openapi", options));
  access_options(downtown.command("call <service_id> <action_id>").description(t({ zh: "按注册方法调用Action并输出响应", en: "call a registered action and output its response" })))
    .option("--input <file>", t({ zh: "JSON对象文件；-从stdin读取；raw Action保留原文", en: "JSON object file; - reads stdin; raw actions preserve text" }))
    .option("--admin", t({ zh: "使用目标已保存的管理员会话", en: "use the target's saved administrator session" }))
    .action((service_id: string, action_id: string, options: DowntownAccessOptions) => run_downtown_access("call", options, service_id, action_id));
}
