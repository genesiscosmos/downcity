/**
 * Cloudflare Worker 中使用 Downtown 的最小模板。
 *
 * Worker 只拥有平台入口和 D1 binding，领域能力仍由 Downtown 负责。
 */

import { Downtown } from "@downcity/downtown";
import { Database } from "@downcity/database-d1";
import type { Env } from "./types/env.js";

let downtown: Downtown | undefined;

/** 共享服务装配；准备实例和请求实例各自拥有独立生命周期。 */
function create_downtown(env: Env): Downtown {
  return new Downtown({
    database: new Database({ binding: env.DB }),
    database_initialization: "prepared",
  });
}

/** 由 fed deploy 在发布前调用，env.DB 指向本次部署的远程 D1。 */
export async function prepare_database(env: Env): Promise<void> {
  const fed = create_downtown(env);
  await fed.prepare_database();
}

/** 为当前 Worker isolate 创建并复用 Downtown。 */
function get_downtown(env: Env): Downtown {
  downtown ??= create_downtown(env);
  return downtown;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await get_downtown(env)).fetch(request);
  },
};
