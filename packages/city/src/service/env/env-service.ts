/**
 * env 内置服务。
 *
 * 关键说明（中文）
 * - Federation 默认注册该 service。
 * - EnvProvider 由 Federation 初始化并注入，不需要产品手动传入。
 */

import { Service } from "../service.js";

export class EnvService extends Service {
  constructor() {
    super({ id: "env", name: "Env" });
    this.instruction = [
      "管理 Federation 运行时环境变量。",
      "适用于导入、列出、更新和删除 Federation 内部使用的 env 配置。",
      "不要把真实密钥暴露给产品前端；应只在可信管理端调用这些接口。",
    ].join("\n");

    this.action("list", async (ctx) => {
      const list = await this._env!.list();
      const items = Array.isArray(list) ? list : [];
      return { items };
    }, { method: "GET", auth: ["admin"] });

    this.action("upsert", async (ctx) => {
      const entry = await this._env!.upsert({
        key: String(ctx.input.key ?? ""),
        value: String(ctx.input.value ?? ""),
      });
      return { success: true, key: entry.key };
    }, { auth: ["admin"] });

    this.action("remove", async (ctx) => {
      await this._env!.remove(String(ctx.input.key ?? ""));
      return { success: true, key: String(ctx.input.key ?? "") };
    }, { auth: ["admin"] });

    this.action("import", async (ctx) => {
      const entries = await this._env!.import(ctx.input.raw);
      return { success: true, count: entries.length, keys: entries.map((e) => e.key) };
    }, { auth: ["admin"] });

    this.action("refresh", async () => {
      await this._env!.refresh();
      const items = await this._env!.list();
      return { success: true, count: items.length };
    }, { auth: ["admin"] });
  }
}
