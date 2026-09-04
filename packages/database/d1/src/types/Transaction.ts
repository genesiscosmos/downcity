/** D1 乐观事务内部类型。 */

/** 已编译的 D1 SQL 命令。 */
export interface CompiledQuery {
  /** 使用 D1 占位符的 SQL。 */
  sql: string;
  /** 已经过 Drizzle 编码的参数。 */
  params: unknown[];
}

/** 一次即时读取的完整快照。 */
export interface ReadSnapshot {
  /** 读取的物理表名。 */
  table_name: string;
  /** 原始等值查询条件。 */
  where: Record<string, unknown>;
  /** 查询返回的完整记录。 */
  rows: Record<string, unknown>[];
}

/** D1 事务本地视图中的结构化写入。 */
export type TransactionMutation =
  | {
      /** 写入类型。 */
      kind: "insert";
      /** 写入目标物理表名。 */
      table_name: string;
      /** 待插入的记录。 */
      rows: Record<string, unknown>[];
    }
  | {
      /** 写入类型。 */
      kind: "insert_if_absent";
      /** 写入目标物理表名。 */
      table_name: string;
      /** 待插入的记录。 */
      row: Record<string, unknown>;
      /** 用于判断冲突的主键或单列唯一键。 */
      unique_keys: string[];
    }
  | {
      /** 写入类型。 */
      kind: "update";
      /** 写入目标物理表名。 */
      table_name: string;
      /** 等值更新条件。 */
      where: Record<string, unknown>;
      /** 写入的新字段。 */
      values: Record<string, unknown>;
    }
  | {
      /** 写入类型。 */
      kind: "delete";
      /** 写入目标物理表名。 */
      table_name: string;
      /** 等值删除条件。 */
      where: Record<string, unknown>;
    };
