/** 不包含异常消息、堆栈或业务参数的有界日志异常树。 */
export type SafeErrorDiagnostic = {
  /** 固定白名单异常类型；未知对象使用 UnknownError。 */
  name: string;
  /** 固定白名单领域、模型或 Node 错误代码；未知时省略。 */
  code?: string;
  /** 固定白名单执行或收尾阶段。 */
  phase?: string;
  /** SQLite 数字扩展码，不包含数据库消息。 */
  sqlite_code?: number;
  /** 安全异常的原始原因，最多保留六层。 */
  cause?: SafeErrorDiagnostic;
  /** 收尾失败的独立原因，不替换原始原因。 */
  secondary_error?: SafeErrorDiagnostic;
  /** 聚合失败的前八项；不复制任意对象字段。 */
  errors?: SafeErrorDiagnostic[];
  /** 达到深度、项数上限或遇到循环引用时为 true。 */
  truncated?: boolean;
};
