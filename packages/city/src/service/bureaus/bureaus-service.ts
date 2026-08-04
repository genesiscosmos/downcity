/**
 * Federation Bureau 身份与机器凭证服务。
 *
 * Root Admin 管理 Bureau 生命周期和 Token 注册表。Bureau Token 只能读取
 * 自身身份，不能获得 Federation 全局管理权限。
 */

import { Service } from "../service.js";
import type { BureauTokenStore } from "../../federation/auth/bureau-token-store.js";
import { BureauStore } from "./bureau-store.js";

/** Federation 内置 Bureau 管理服务。 */
export class BureausService extends Service {
  private bureau_store!: BureauStore;
  private token_store!: BureauTokenStore;

  constructor() {
    super({ id: "bureaus", name: "Bureaus" });
    this.instruction = [
      "管理 Federation 中稳定的 Bureau 产品身份。",
      "Bureau Token 必须绑定 Bureau，且只代表当前 Bureau 的机器身份。",
      "每个 Bureau 拥有一条独立 Server 配置；URL 不要求跨 Bureau 唯一。",
    ].join("\n");

    this.action("list", async () => ({ items: await this.bureau_store.list() }), {
      method: "GET",
      auth: ["admin"],
    });

    this.action("create", async (ctx) => await this.bureau_store.create({
      name: String(ctx.input.name ?? ""),
      server_url: String(ctx.input.server_url ?? ""),
      bureau_id: read_optional_bureau_id(ctx.input.bureau_id),
    }), { auth: ["admin"] });

    this.action("pause", async (ctx) => (
      await this.bureau_store.set_state(String(ctx.input.bureau_id ?? ""), "paused")
    ), { auth: ["admin"] });

    this.action("activate", async (ctx) => (
      await this.bureau_store.set_state(String(ctx.input.bureau_id ?? ""), "active")
    ), { auth: ["admin"] });

    this.action("server/update", async (ctx) => (
      await this.bureau_store.update_server(
        String(ctx.input.bureau_id ?? ""),
        String(ctx.input.server_url ?? ""),
      )
    ), { auth: ["admin"] });

    this.action("archive", async (ctx) => {
      const bureau = await this.bureau_store.archive(String(ctx.input.bureau_id ?? ""));
      await this.token_store.revoke_for_bureau(bureau.bureau_id);
      return bureau;
    }, { auth: ["admin"] });

    this.action("tokens/register", async (ctx) => {
      const bureau = await this.bureau_store.require(String(ctx.input.bureau_id ?? ""));
      if (bureau.state === "archived") {
        throw new TypeError(`Archived Bureau cannot register tokens: ${bureau.bureau_id}`);
      }
      return await this.token_store.register({
        bureau_id: bureau.bureau_id,
        token_id: String(ctx.input.token_id ?? ""),
        purpose: String(ctx.input.purpose ?? ""),
        token_hash: String(ctx.input.token_hash ?? ""),
      });
    }, { auth: ["admin"] });

    this.action("tokens/list", async (ctx) => ({
      items: await this.token_store.list(read_optional_bureau_id(ctx.input.bureau_id)),
    }), { method: "GET", auth: ["admin"] });

    this.action("tokens/revoke", async (ctx) => {
      await this.token_store.revoke(String(ctx.input.token_id ?? ""));
      return { success: true };
    }, { auth: ["admin"] });

    this.action("me", async (ctx) => ({
      bureau: ctx.bureau,
      token: ctx.bureau_token,
    }), { method: "GET", auth: ["bureau"] });

    this.action("current", async (ctx) => ({ bureau: ctx.bureau }), {
      method: "GET",
      auth: ["user"],
    });
  }

  protected override async on_init(): Promise<void> {
    this.bureau_store = this._bureauStore!;
    this.token_store = this._bureauTokenStore!;
  }
}

/** 读取可选 opaque Bureau ID，不对值做规范化或改写。 */
function read_optional_bureau_id(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
