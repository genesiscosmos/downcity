/**
 * Federation Bureau 管理凭证服务。
 *
 * Token 明文由 CLI 在运维侧生成；本服务只登记 hash、列出元数据和撤销记录。
 */

import { Service } from "../service.js";
import type { BureauTokenStore } from "../../federation/auth/bureau-token-store.js";

/** Federation 内置 Bureau 上下文服务。 */
export class BureausService extends Service {
  private store!: BureauTokenStore;

  constructor() {
    super({ id: "bureaus", name: "Bureaus" });
    this.instruction = [
      "管理 Federation 的 Bureau Token 注册表。",
      "管理端可登记 CLI 生成的 Token hash、列出记录或立即撤销访问。",
      "Federation 不生成或返回 Bureau Token 明文。",
    ].join("\n");

    this.action("register", async (ctx) => {
      return await this.store.register({
        token_id: String(ctx.input.token_id ?? ""),
        purpose: String(ctx.input.purpose ?? ""),
        token_hash: String(ctx.input.token_hash ?? ""),
      });
    }, { auth: ["admin"] });

    this.action("list", async () => ({ items: await this.store.list() }), {
      method: "GET",
      auth: ["admin"],
    });

    this.action("revoke", async (ctx) => {
      await this.store.revoke(String(ctx.input.token_id ?? ""));
      return { success: true };
    }, { auth: ["admin"] });
  }

  protected override async on_init(): Promise<void> {
    this.store = this._bureauTokenStore!;
  }
}
