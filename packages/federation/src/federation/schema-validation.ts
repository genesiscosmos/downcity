/**
 * Federation 当前 Schema 不变量校验。
 *
 * 该模块不识别或迁移历史结构，只检查当前 Bureau 身份与 Server 配置是否保持一对一。
 */

import type { Database } from "../database/Database.js";

/** 拒绝当前 Schema 中缺少对应身份或 Server 配置的孤立记录。 */
export async function assert_bureau_server_records(database: Database): Promise<void> {
  const orphan_bureaus = await database.query<{ bureau_id: string }>({
    sql: "SELECT b.bureau_id FROM federation_bureaus b LEFT JOIN federation_bureau_servers s ON s.bureau_id = b.bureau_id WHERE s.bureau_id IS NULL LIMIT 1",
    params: [],
  });
  if (orphan_bureaus.rows.length > 0) {
    throw new Error(
      `Federation Bureau Server record is missing: ${orphan_bureaus.rows[0].bureau_id}`,
    );
  }
  const orphan_servers = await database.query<{ bureau_id: string }>({
    sql: "SELECT s.bureau_id FROM federation_bureau_servers s LEFT JOIN federation_bureaus b ON b.bureau_id = s.bureau_id WHERE b.bureau_id IS NULL LIMIT 1",
    params: [],
  });
  if (orphan_servers.rows.length > 0) {
    throw new Error(
      `Federation Bureau identity is missing: ${orphan_servers.rows[0].bureau_id}`,
    );
  }
}
