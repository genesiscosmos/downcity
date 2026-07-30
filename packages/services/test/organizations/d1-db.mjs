/** Organizations 测试使用的真实 Miniflare D1 数据库工厂。 */

import { drizzle } from "drizzle-orm/d1"
import { Miniflare } from "miniflare"

/** 创建隔离的 Miniflare D1 与 Drizzle Client。 */
export async function create_d1_db() {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: crypto.randomUUID() },
  })
  const client = await miniflare.getD1Database("DB")
  const database = drizzle(client)
  return {
    database,
    dispose: () => miniflare.dispose(),
  }
}
