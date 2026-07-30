/** City 测试使用的 SQLite Database Adapter 工厂。 */

import { Database } from "../../database-sqlite/bin/index.js"

export function createSqliteDb(filename) {
  return new Database({ filename })
}
