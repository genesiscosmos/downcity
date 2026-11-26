/** Agent 变量的固定存储命令数据；JSON 文本与 null 分别表达值和缺失。 */
export interface AgentVariableMutation {
  /** 本次短事务的幂等 UUID，未知确认时沿用原 receipt。 */
  operation_id: string;
  /** 完整宿主键，不由 SDK 推断语义。 */
  key: string;
  /** 覆盖、删除或条件替换。 */
  mode: "set" | "delete" | "compare_exchange";
  /** CAS 期望的 JSON 文本；null 表示键不存在，其他模式省略。 */
  expected?: string | null;
  /** 待写 JSON 文本；null 表示删除键。 */
  value: string | null;
}
