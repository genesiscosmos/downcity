/**
 * 数据库 schema 相关类型模块。
 *
 * 定义 City 和用户业务表的数据库 schema 输入类型。
 */

import type { AnyPgTable } from "drizzle-orm/pg-core";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";

/**
 * 用户传给 City 的业务数据库 schema。
 *
 * key 是业务表在 `city.table(key)` 中使用的名称，value 是 Drizzle table 对象。
 */
export type CityUserSchemaInput = Record<string, AnySQLiteTable | AnyPgTable>;
