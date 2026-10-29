/**
 * Cloudflare Worker 中使用 Federation 的最小模板。
 *
 * Worker 只拥有平台入口和 D1 binding，领域能力仍由 Federation 负责。
 */

import { Federation } from "@downcity/federation";
import { Database } from "@downcity/database-d1";
import type { Env } from "./types/env.js";

let federation: Federation | undefined;

/** 共享服务装配；准备实例和请求实例各自拥有独立生命周期。 */
function create_federation(env: Env): Federation {
  return new Federation({
    database: new Database({ binding: env.DB }),
    database_initialization: "prepared",
  });
}

/** 由 fed deploy 在发布前调用，env.DB 指向本次部署的远程 D1。 */
export async function prepare_database(env: Env): Promise<void> {
  const fed = create_federation(env);
  await fed.prepare_database();
}

/** 为当前 Worker isolate 创建并复用 Federation。 */
function get_federation(env: Env): Federation {
  federation ??= create_federation(env);
  return federation;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await get_federation(env)).fetch(request);
  },
};
