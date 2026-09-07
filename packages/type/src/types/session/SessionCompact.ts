/** Session 压缩结果公共协议。 */

/** Session 显式压缩的稳定结束原因。 */
export type SessionCompactReason =
  | "compacted"
  | "nothing_to_compact"
  | "compact_failed";
