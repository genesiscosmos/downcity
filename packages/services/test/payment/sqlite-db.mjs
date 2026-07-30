/** Payment 测试使用的 SQLite Database Adapter 工厂。 */

import { Database } from "@downcity/database-sqlite"

export function createSqliteDb(filename) {
  return new Database({ filename })
}
