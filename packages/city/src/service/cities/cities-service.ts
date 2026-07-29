/**
 * Cities 内置服务。
 *
 * 关键说明（中文）
 * - Federation 默认注册该 service。
 * - CityStore 由 Federation 初始化并注入，确保鉴权和管理 API 使用同一份 city 状态。
 */

import { Service } from "../service.js";
import type { Authenticator } from "../../federation/auth/authenticator.js";
import { CityStore } from "./city-store.js";

export class CitiesService extends Service {
  private store!: CityStore;
  private auth!: Authenticator;

  constructor() {
    super({ id: "cities", name: "Cities" });
    this.instruction = [
      "管理 City 实体与用户 token 签发。",
      "City 是用户侧调用的边界，user_token 会绑定到具体 City。",
      "管理端通常先创建 City，再通过 tokens/apply 为某个 user_id 签发可调用的 user_token。",
    ].join("\n");

    this.action("list", async () => ({ items: await this.store.list() }), { method: "GET", auth: ["admin"] });

    this.action("create", async (ctx) => {
      return await this.store.create({
        name: String(ctx.input.name ?? ""),
        city_id: String(ctx.input.city_id ?? "").trim() || undefined,
      });
    }, { auth: ["admin"] });

    this.action("pause", async (ctx) => {
      return await this.store.setStatus(String(ctx.input.city_id ?? ""), "paused");
    }, { auth: ["admin"] });

    this.action("activate", async (ctx) => {
      return await this.store.setStatus(String(ctx.input.city_id ?? ""), "active");
    }, { auth: ["admin"] });

    this.action("remove", async (ctx) => {
      await this.store.remove(String(ctx.input.city_id ?? ""));
      return { success: true };
    }, { auth: ["admin"] });

    this.action("tokens/apply", async (ctx) => {
      return await this.auth.createToken({
        city_id: String(ctx.input.city_id ?? ""),
        user_id: String(ctx.input.user_id ?? ""),
        metadata: ctx.input.metadata as Record<string, unknown> | undefined,
        ttl: ctx.input.ttl as string | number | undefined,
      });
    }, { auth: ["admin"] });
  }

  protected override async on_init(): Promise<void> {
    this.store = this._cityStore!;
    this.auth = this._authenticator!;

    const existing = await this.store.get("city_downcity");
    if (!existing) {
      await this.store.create({ city_id: "city_downcity", name: "Downcity" });
    }
  }
}
