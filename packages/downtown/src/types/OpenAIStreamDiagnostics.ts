/** OpenAI-compatible 流内部诊断类型；仅描述安全标识和有界统计，不保存响应正文。 */

/** 单次上游流的关联身份。 */
export interface OpenAIStreamIdentity {
  /** 已校验并限制长度的供应商请求 ID；同时出现在 model_start 中。 */
  request_id: string;
  /** Downtown 对外模型 ID。 */
  model_id: string;
}

/** 单个工具调用的有限诊断摘要。 */
export interface OpenAIToolStreamSummary {
  /** 流内内容块标识，不包含工具参数。 */
  content_id: string;
  /** 经过字符白名单与长度限制的工具名称。 */
  tool_name: string;
  /** 实际接收的参数增量次数，不代表 token 数。 */
  delta_count: number;
  /** 参数增量编码为 UTF-8 后的累计字节数。 */
  input_bytes: number;
}

/** 上游流读取结束的稳定原因。 */
export type OpenAIStreamEndReason = "done" | "eof" | "error" | "cancelled";
