/** SQLite Database 构造参数类型。 */

/** SQLite Database Adapter 构造参数。 */
export interface DatabaseOptions {
  /** SQLite 数据库文件路径；测试可使用 `:memory:`。 */
  filename: string;
  /** 是否启用 WAL；文件数据库默认启用，内存数据库自动忽略。 */
  wal?: boolean;
}
