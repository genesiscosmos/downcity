/** runtime 辅助 SDK 的有界查询参数；仅含业务引用，不包含调用身份。 */

/** 查询本 Session 中一次执行的调用回执。 */
export interface ReceiptQuery {
  /** 原执行标识；权限仍由当前可信 Session 再检查。 */
  readonly execution_id: string;
  /** 当前分页起点。 */
  readonly cursor: number;
}

/** 读取本 Session 的短期非秘密大结果。 */
export interface ResultQuery {
  /** 宿主生成且绑定当前 Session 的结果引用。 */
  readonly result_ref: string;
  /** UTF-16 码元偏移，由上一页 next_offset 继续。 */
  readonly offset: number;
}
