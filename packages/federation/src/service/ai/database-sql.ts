/**
 * AI 与 Relay 的显式 SQL 方言边界。
 *
 * 领域查询以问号声明绑定位置，在提交 PG 前转换为编号参数；JSON 运算和
 * 函数由查询所属模块显式选择。仅处理本目录维护的 SQL，不接受外部 SQL。
 */
import type {
  DatabaseQueryResult,
  DatabaseStatement,
  ServiceDatabaseContext,
} from "../../types/database/Database.js";

/** PG 原始查询的 int8 默认返回字符串；这些领域数值对外统一为 number。 */
const numeric_columns = new Set([
  "uncached_input_tokens", "cached_input_tokens", "output_tokens", "reasoning_tokens",
  "image_count", "video_seconds", "audio_seconds", "request_count", "duration_ms",
  "attempt_count", "cooldown_until", "first_output_ms",
]);

/** 执行领域查询，校验绑定数量并还原领域数值，保留 NULL 和文本字段。 */
export async function query_service_database<TRow extends Record<string, unknown> = Record<string, unknown>>(
  database: ServiceDatabaseContext,
  statement: DatabaseStatement,
): Promise<DatabaseQueryResult<TRow>> {
  if (database.schema_id !== "postgresql") return database.query<TRow>(statement);
  let parameter_index = 0;
  const sql = statement.sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/gu, (token) =>
    token === "?" ? `$${++parameter_index}` : token,
  );
  if (parameter_index !== statement.params.length) {
    throw new TypeError("AI SQL parameter count does not match bound values");
  }
  const result = await database.query<TRow>({ sql, params: statement.params });
  return {
    ...result,
    rows: result.rows.map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        numeric_columns.has(key) && typeof value === "string" ? Number(value) : value,
      ]),
    ) as TRow),
  };
}

/** 读取结算负载内的数值积分；缺失或 JSON null 保持 SQL NULL。 */
export function settlement_credits_sql(schema_id: string): string {
  return schema_id === "postgresql"
    ? "CAST(s.payload_json::jsonb #>> '{charge,credits}' AS double precision)"
    : "json_extract(s.payload_json, '$.charge.credits')";
}
