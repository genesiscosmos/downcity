/**
 * Cloudflare Worker 中使用 Federation 的最小模板。
 *
 * Worker 只拥有平台入口和 D1 binding，领域能力仍由 Federation 负责。
 */

import { Federation } from "@downcity/federation";
import { Database } from "@downcity/database-d1";
import type { Env } from "./types/env.js";

let federation: Federation | undefined;

/** 为当前 Worker isolate 创建并复用 Federation。 */
async function get_federation(env: Env): Promise<Federation> {
  if (!federation) {
    federation = new Federation({
      database: new Database({ binding: env.DB }),
    });
    await federation.health();
  }
  return federation;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await get_federation(env)).fetch(request);
  },
};
