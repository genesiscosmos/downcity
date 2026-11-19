/**
 * env 内置服务。
 *
 * 关键说明（中文）
 * - Federation 默认注册该 service。
 * - EnvProvider 由 Federation 初始化并注入，不需要产品手动传入。
 */

import { Service } from "../service.js";
import { env_api_documentation } from "./documentation.js";

export class EnvService extends Service {
  constructor() {
    super({
      id: "env", name: "Env",
      description: "管理 Federation 的持久化环境配置及当前实例缓存。",
      requirements: ["Federation 已初始化环境存储。", "业务操作需要管理员身份。"],
      availability: () => this._env
        ? { status: "ready" }
        : { status: "unavailable", reason: "环境存储尚未初始化。" },
    });
    this.instruction = [
      "管理 Federation 运行时环境变量。",
      "适用于导入、列出、更新和删除 Federation 内部使用的 env 配置。",
      "所有 action 需要管理员 Bearer 凭据；list 使用 GET，其余使用 POST JSON 对象。",
      "list 返回明文值，不要把真实密钥暴露给产品前端；应只在可信管理端调用这些接口。",
      "upsert/remove/import 会同步当前实例缓存；直接改数据库后调用 refresh。",
      "import 接收 { raw: dotenv文本 }，逐项写入，发生错误不会回滚此前写入。",
      "调用示例：POST /v1/env/upsert，正文 {\"key\":\"EXAMPLE_KEY\",\"value\":\"example-value\"}。",
      "使用 GET /v1/services/env 获取完整参数、响应、错误说明与公开占位示例。",
    ].join("\n");

    this.action("list", async (ctx) => {
      const list = await this._env!.list();
      const items = Array.isArray(list) ? list : [];
      return { items };
    }, { method: "GET", auth: ["admin"], documentation: env_api_documentation.list });

    this.action("upsert", async (ctx) => {
      const entry = await this._env!.upsert({
        key: String(ctx.input.key ?? ""),
        value: String(ctx.input.value ?? ""),
      });
      return { success: true, key: entry.key };
    }, { auth: ["admin"], documentation: env_api_documentation.upsert });

    this.action("remove", async (ctx) => {
      await this._env!.remove(String(ctx.input.key ?? ""));
      return { success: true, key: String(ctx.input.key ?? "") };
    }, { auth: ["admin"], documentation: env_api_documentation.remove });

    this.action("import", async (ctx) => {
      const entries = await this._env!.import(ctx.input.raw);
      return { success: true, count: entries.length, keys: entries.map((e) => e.key) };
    }, { auth: ["admin"], documentation: env_api_documentation.import });

    this.action("refresh", async () => {
      await this._env!.refresh();
      const items = await this._env!.list();
      return { success: true, count: items.length };
    }, { auth: ["admin"], documentation: env_api_documentation.refresh });
  }
}
