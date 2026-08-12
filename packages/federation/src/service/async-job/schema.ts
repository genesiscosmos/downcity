/**
 * 通用异步任务数据库 schema 模块。
 *
 * async_jobs 是 City 的统一异步任务表，用于图片生成、视频生成、
 * 文件处理等需要跨请求恢复或轮询的任务。
 */

import { pgTable, text as pgText } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";

const DEFAULT_ASYNC_JOBS_TABLE = "async_jobs";

/**
 * 默认 SQLite 异步任务表。
 */
export const sqliteAsyncJobs = sqliteTable(DEFAULT_ASYNC_JOBS_TABLE, {
  /** City 内部生成的异步任务 ID。 */
  job_id: sqliteText("job_id").primaryKey(),
  /** 任务类型，例如 `ai.image.generate`。 */
  job_type: sqliteText("job_type").notNull(),
  /** 任务状态：queued / running / fetching / succeeded / failed。 */
  status: sqliteText("status").notNull(),
  /** 原始任务输入，JSON 字符串。 */
  input_json: sqliteText("input_json").notNull(),
  /** 可恢复任务中间状态，JSON 字符串。 */
  state_json: sqliteText("state_json"),
  /** 成功后的业务结果，JSON 字符串。 */
  result_json: sqliteText("result_json"),
  /** 失败时给客户端展示的错误消息。 */
  error: sqliteText("error"),
  /** 当前任务状态说明，便于客户端展示或排障。 */
  message: sqliteText("message"),
  /** 建议下一次轮询或后台抓取的间隔毫秒数。 */
  poll_after_ms: sqliteText("poll_after_ms"),
  /** 当前 User Token 绑定的 Bureau ID。 */
  bureau_id: sqliteText("bureau_id"),
  /** 当前终端用户 ID。 */
  user_id: sqliteText("user_id"),
  /** 创建该任务的 Service ID。 */
  service_id: sqliteText("service_id"),
  /** 本次任务解析到的模型 ID。 */
  model_id: sqliteText("model_id"),
  /** 创建时间。 */
  created_at: sqliteText("created_at").notNull(),
  /** 更新时间。 */
  updated_at: sqliteText("updated_at").notNull(),
});

/**
 * 默认 Postgres 异步任务表。
 */
export const pgAsyncJobs = pgTable(DEFAULT_ASYNC_JOBS_TABLE, {
  /** City 内部生成的异步任务 ID。 */
  job_id: pgText("job_id").primaryKey(),
  /** 任务类型，例如 `ai.image.generate`。 */
  job_type: pgText("job_type").notNull(),
  /** 任务状态：queued / running / fetching / succeeded / failed。 */
  status: pgText("status").notNull(),
  /** 原始任务输入，JSON 字符串。 */
  input_json: pgText("input_json").notNull(),
  /** 可恢复任务中间状态，JSON 字符串。 */
  state_json: pgText("state_json"),
  /** 成功后的业务结果，JSON 字符串。 */
  result_json: pgText("result_json"),
  /** 失败时给客户端展示的错误消息。 */
  error: pgText("error"),
  /** 当前任务状态说明，便于客户端展示或排障。 */
  message: pgText("message"),
  /** 建议下一次轮询或后台抓取的间隔毫秒数。 */
  poll_after_ms: pgText("poll_after_ms"),
  /** 当前 User Token 绑定的 Bureau ID。 */
  bureau_id: pgText("bureau_id"),
  /** 当前终端用户 ID。 */
  user_id: pgText("user_id"),
  /** 创建该任务的 Service ID。 */
  service_id: pgText("service_id"),
  /** 本次任务解析到的模型 ID。 */
  model_id: pgText("model_id"),
  /** 创建时间。 */
  created_at: pgText("created_at").notNull(),
  /** 更新时间。 */
  updated_at: pgText("updated_at").notNull(),
});
